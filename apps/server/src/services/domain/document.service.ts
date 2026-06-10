import { uuidv7 } from 'uuidv7'
import {
  ERROR_CODES,
  type Chunk,
  type CreateDocumentRequest,
  type Document,
  type DocumentDetail,
  type DocumentVersion,
  type DocumentVersionSummary,
  type PaginationQuery,
  type UpdateDocumentRequest,
} from '@jnowledge/shared'
import { createModels, type Models } from '../../models/index.js'
import type { DB } from '../../models/schema.js'
import {
  toChunk,
  toDocument,
  toDocumentVersion,
  toDocumentVersionSummary,
} from '../../models/mappers.js'
import type { Infra } from '../infra/index.js'
import { QUEUE_INGEST_DOCUMENT } from '../infra/jobs.js'
import { detectType, SUPPORTED_KINDS } from './ingestion/parsers/index.js'
import { DEFAULT_ARCHIVE_LIMITS, getExtractor } from './ingestion/archive/index.js'
import { sha256 } from './ingestion/index.js'
import type { CollectionService, Principal } from './collection.service.js'
import { AppError } from '../../errors.js'

export interface UploadFile {
  buffer: Buffer
  originalName: string
  /** 客户端声称的 MIME，仅作提示；真实类型按魔数检测 */
  clientMime: string
}

export interface ImportFromFileRequest {
  /** 已存物理文件 id（files 表）。 */
  fileId: string
  collectionId: string
  /** 压缩包内条目路径（list 产出的归一化路径）；省略则导入整个文件。 */
  entryPath?: string
  /** 文档标题覆盖（省略则按文件/条目名去扩展名）。 */
  title?: string
}

export interface DocumentDeps {
  db: DB
  models: Models
  infra: Infra
  collectionService: CollectionService
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface DocumentService {
  listByCollection(
    p: Principal,
    collectionId: string,
    page: PaginationQuery,
  ): Promise<PaginatedResult<Document>>
  getDetail(p: Principal, documentId: string): Promise<DocumentDetail>
  createManual(p: Principal, req: CreateDocumentRequest): Promise<Document>
  update(p: Principal, documentId: string, req: UpdateDocumentRequest): Promise<Document>
  upload(p: Principal, collectionId: string, file: UploadFile): Promise<Document>
  /** 从已存物理文件（或其压缩包内某条目，安全解压限额内）导入为知识库文档。 */
  importFromFile(p: Principal, req: ImportFromFileRequest): Promise<Document>
  /** 跨库移动文档（需对源库与目标库均有 editor 权限）。 */
  move(p: Principal, documentId: string, targetCollectionId: string): Promise<Document>
  remove(p: Principal, documentId: string): Promise<void>
  listVersions(p: Principal, documentId: string): Promise<DocumentVersionSummary[]>
  getVersion(p: Principal, documentId: string, versionId: string): Promise<DocumentVersion>
  listChunks(
    p: Principal,
    documentId: string,
    versionId: string,
    page: PaginationQuery,
  ): Promise<PaginatedResult<Chunk>>
}

export function createDocumentService(deps: DocumentDeps): DocumentService {
  const { db, models, infra, collectionService } = deps

  /** 取文档并校验请求者对其所属 collection 的权限。 */
  async function loadWithAccess(p: Principal, documentId: string, minRole: 'viewer' | 'editor') {
    const doc = await models.documents.findById(documentId)
    if (!doc) throw new AppError(ERROR_CODES.DOCUMENT_NOT_FOUND, '文档不存在')
    await collectionService.assertRole(p, doc.collection_id, minRole)
    return doc
  }

  async function enqueueIngest(
    documentId: string,
    payload: { fileId?: string; versionId?: string },
  ) {
    await infra.jobs.enqueue(QUEUE_INGEST_DOCUMENT, { documentId, ...payload })
  }

  async function upload(p: Principal, collectionId: string, file: UploadFile): Promise<Document> {
    await collectionService.assertRole(p, collectionId, 'editor')

    // 魔数检测：早拒不支持类型（好 UX + 安全边界）
    const detected = await detectType(file.buffer)
    if (!SUPPORTED_KINDS.has(detected.kind)) {
      throw new AppError(
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        `不支持的文件类型: ${detected.mimeType}`,
      )
    }

    const checksum = sha256(file.buffer)
    // 按 checksum 去重物理文件
    let fileRow = await models.files.findByChecksum(checksum)
    if (!fileRow) {
      const fileId = uuidv7()
      const storageKey = `files/${checksum.slice(0, 2)}/${checksum}`
      await infra.storage.putObject(storageKey, file.buffer, detected.mimeType)
      fileRow = await models.files.insert({
        id: fileId,
        storageBucket: infra.storage.bucket,
        storageKey,
        fileSize: file.buffer.length,
        mimeType: detected.mimeType,
        checksum,
        originalName: file.originalName,
        createdBy: p.uid,
      })
    }

    const documentId = uuidv7()
    await models.documents.insert({
      id: documentId,
      collectionId,
      title: stripExt(file.originalName),
      sourceType: 'upload',
      status: 'pending',
      createdBy: p.uid,
    })

    await enqueueIngest(documentId, { fileId: fileRow.id })
    const doc = await models.documents.findById(documentId)
    return toDocument(doc!)
  }

  return {
    async listByCollection(p, collectionId, page) {
      await collectionService.assertRole(p, collectionId, 'viewer')
      const { items, total } = await models.documents.listByCollection(
        collectionId,
        page.pageSize,
        (page.page - 1) * page.pageSize,
      )
      return { items: items.map(toDocument), total, page: page.page, pageSize: page.pageSize }
    },

    async getDetail(p, documentId) {
      const doc = await loadWithAccess(p, documentId, 'viewer')
      const currentVersion = doc.current_version_id
        ? await models.documentVersions.findById(doc.current_version_id)
        : undefined
      const chunkCount = currentVersion ? await models.chunks.countByVersion(currentVersion.id) : 0
      return {
        document: toDocument(doc),
        currentVersion: currentVersion ? toDocumentVersion(currentVersion) : null,
        chunkCount,
      }
    },

    async createManual(p, req) {
      await collectionService.assertRole(p, req.collectionId, 'editor')
      const documentId = uuidv7()
      const versionId = uuidv7()

      await db.transaction().execute(async (trx) => {
        const m = createModels(trx)
        await m.documents.insert({
          id: documentId,
          collectionId: req.collectionId,
          title: req.title,
          sourceType: 'manual',
          status: 'pending',
          createdBy: p.uid,
        })
        await m.documentVersions.insert({
          id: versionId,
          documentId,
          versionNo: 1,
          content: req.content,
          checksum: sha256(req.content),
          sourceFileId: null,
          authorId: p.uid,
        })
        await m.documents.setCurrentVersion(documentId, versionId)
      })

      await enqueueIngest(documentId, { versionId })
      const doc = await models.documents.findById(documentId)
      return toDocument(doc!)
    },

    async update(p, documentId, req) {
      const doc = await loadWithAccess(p, documentId, 'editor')

      if (req.title !== undefined) {
        await models.documents.setTitle(documentId, req.title)
      }

      if (req.content !== undefined) {
        const latestChecksum = await models.documentVersions.latestChecksum(documentId)
        const newChecksum = sha256(req.content)
        // 内容未变则跳过建新版本/重 embedding
        if (newChecksum !== latestChecksum) {
          const versionId = uuidv7()
          const versionNo = await models.documentVersions.nextVersionNo(documentId)
          await models.documentVersions.insert({
            id: versionId,
            documentId,
            versionNo,
            content: req.content,
            checksum: newChecksum,
            sourceFileId: null,
            authorId: p.uid,
          })
          await models.documents.setCurrentVersion(documentId, versionId)
          await models.documents.setStatus(documentId, 'pending')
          await enqueueIngest(documentId, { versionId })
        }
      }

      const fresh = await models.documents.findById(documentId)
      return toDocument(fresh ?? doc)
    },

    upload,

    async importFromFile(p, req) {
      const fileRow = await models.files.findById(req.fileId)
      if (!fileRow) throw new AppError(ERROR_CODES.NOT_FOUND, '文件不存在')
      // 文件不挂库：按上传者（或 admin）守读边界；目标库的 editor 权限由 upload 校验。
      if (fileRow.created_by !== p.uid && p.role !== 'admin') {
        throw new AppError(ERROR_CODES.FORBIDDEN, '无权访问该文件')
      }

      const raw = await infra.storage.getObject(fileRow.storage_key)
      let buffer = raw
      let originalName = fileRow.original_name ?? req.fileId
      if (req.entryPath) {
        const extractor = getExtractor(fileRow.mime_type)
        if (!extractor) {
          throw new AppError(
            ERROR_CODES.UNSUPPORTED_FILE_TYPE,
            `该文件不是受支持的压缩包，无法按条目解出: ${fileRow.mime_type}`,
          )
        }
        // 安全解压（按实际字节计数熔断，见 ingestion/archive）；嵌套压缩包条目会在
        // upload 的魔数检测处被拒（archive 不在 SUPPORTED_KINDS），即不递归解压。
        buffer = await extractor.extract(raw, req.entryPath, DEFAULT_ARCHIVE_LIMITS)
        originalName = req.entryPath.split('/').pop() || req.entryPath
      }

      const doc = await upload(p, req.collectionId, {
        buffer,
        originalName,
        clientMime: 'application/octet-stream',
      })
      if (req.title && req.title !== doc.title) {
        await models.documents.setTitle(doc.id, req.title)
        const fresh = await models.documents.findById(doc.id)
        return toDocument(fresh!)
      }
      return doc
    },

    async move(p, documentId, targetCollectionId) {
      const doc = await loadWithAccess(p, documentId, 'editor')
      if (doc.collection_id === targetCollectionId) return toDocument(doc)
      // 目标库也需 editor 权限（防把文档塞进无权库）。
      await collectionService.assertRole(p, targetCollectionId, 'editor')
      await models.documents.setCollection(documentId, targetCollectionId)
      const fresh = await models.documents.findById(documentId)
      return toDocument(fresh ?? doc)
    },

    async remove(p, documentId) {
      await loadWithAccess(p, documentId, 'editor')
      await models.documents.softDelete(documentId)
    },

    async listVersions(p, documentId) {
      await loadWithAccess(p, documentId, 'viewer')
      const rows = await models.documentVersions.listByDocument(documentId)
      return rows.map(toDocumentVersionSummary)
    },

    async getVersion(p, documentId, versionId) {
      await loadWithAccess(p, documentId, 'viewer')
      const row = await models.documentVersions.findById(versionId)
      if (!row || row.document_id !== documentId) {
        throw new AppError(ERROR_CODES.NOT_FOUND, '版本不存在')
      }
      return toDocumentVersion(row)
    },

    async listChunks(p, documentId, versionId, page) {
      await loadWithAccess(p, documentId, 'viewer')
      const version = await models.documentVersions.findById(versionId)
      if (!version || version.document_id !== documentId) {
        throw new AppError(ERROR_CODES.NOT_FOUND, '版本不存在')
      }
      const { items, total } = await models.chunks.listByVersion(
        versionId,
        page.pageSize,
        (page.page - 1) * page.pageSize,
      )
      return { items: items.map(toChunk), total, page: page.page, pageSize: page.pageSize }
    },
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}
