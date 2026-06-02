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
import type { DB } from '../../db/index.js'
import { createModels, type Models } from '../../models/index.js'
import {
  toChunk,
  toDocument,
  toDocumentVersion,
  toDocumentVersionSummary,
} from '../../models/mappers.js'
import type { Infra } from '../infra/index.js'
import { QUEUE_INGEST_DOCUMENT } from '../infra/jobs.js'
import { detectType, SUPPORTED_KINDS } from './ingestion/parsers/index.js'
import { sha256 } from './ingestion/index.js'
import type { CollectionService, Principal } from './collection.service.js'
import { AppError } from '../../errors.js'

export interface UploadFile {
  buffer: Buffer
  originalName: string
  /** 客户端声称的 MIME，仅作提示；真实类型按魔数检测 */
  clientMime: string
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

  async function enqueueIngest(documentId: string, payload: { fileId?: string; versionId?: string }) {
    await infra.jobs.enqueue(QUEUE_INGEST_DOCUMENT, { documentId, ...payload })
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
      const chunkCount = currentVersion
        ? await models.chunks.countByVersion(currentVersion.id)
        : 0
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

    async upload(p, collectionId, file) {
      await collectionService.assertRole(p, collectionId, 'editor')

      // 魔数检测：早拒不支持类型（好 UX + 安全边界）
      const detected = await detectType(file.buffer)
      if (!SUPPORTED_KINDS.has(detected.kind)) {
        throw new AppError(ERROR_CODES.UNSUPPORTED_FILE_TYPE, `不支持的文件类型: ${detected.mimeType}`)
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
