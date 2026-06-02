import { createHash } from 'node:crypto'
import { uuidv7 } from 'uuidv7'
import type { DB } from '../../../db/index.js'
import { createModels, type Models } from '../../../models/index.js'
import type { Infra } from '../../infra/index.js'
import type { Logger } from '../../../logger.js'
import type { IngestDocumentJob } from '../../infra/jobs.js'
import { detectType, getParser, SUPPORTED_KINDS } from './parsers/index.js'
import { chunkMarkdown, DEFAULT_CHUNK_PARAMS, type ChunkParams } from './chunker.js'

export { sha256 }
function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface IngestionDeps {
  db: DB
  models: Models
  infra: Infra
  logger: Logger
}

/**
 * 确定性摄取流水线（一期无 LLM）。作为 pg-boss worker 运行：
 * parsing → chunking → embedding(留桩) → ready；任一步失败 → failed。
 */
export interface IngestionService {
  /** worker 入口：处理一个摄取任务。 */
  run(job: IngestDocumentJob): Promise<void>
}

export function createIngestionService(deps: IngestionDeps): IngestionService {
  const { db, models, infra, logger } = deps

  async function run(job: IngestDocumentJob): Promise<void> {
    const { documentId, fileId } = job
    try {
      const doc = await models.documents.findById(documentId)
      if (!doc) {
        logger.warn({ documentId }, 'ingest: document 不存在，跳过')
        return
      }

      let versionId: string
      let content: string

      if (fileId) {
        // 上传路径：解析文件 → 规范 Markdown → 建版本
        await models.documents.setStatus(documentId, 'parsing')
        content = await parseFile(fileId)

        await models.documents.setStatus(documentId, 'chunking')
        versionId = await createVersionFromParse(doc.id, content, fileId, doc.created_by)
        await models.documents.setCurrentVersion(documentId, versionId)
      } else {
        // 手动路径：版本已同步创建，仅重新分块
        if (!job.versionId) throw new Error('手动摄取任务缺少 versionId')
        versionId = job.versionId
        await models.documents.setStatus(documentId, 'chunking')
        const version = await models.documentVersions.findById(versionId)
        if (!version) throw new Error(`version 不存在: ${versionId}`)
        content = version.content
      }

      // 分块（settings 可覆盖参数，二期接；一期用默认）
      const params: ChunkParams = resolveChunkParams(doc.collection_id)
      const pieces = chunkMarkdown(content, params)

      await db.transaction().execute(async (trx) => {
        const m = createModels(trx)
        await m.chunks.deleteByVersion(versionId)
        await m.chunks.insertMany(
          pieces.map((p, i) => ({
            id: uuidv7(),
            documentVersionId: versionId,
            seq: i,
            content: p.content,
            tokenCount: p.tokenCount,
            charStart: p.charStart,
            charEnd: p.charEnd,
            headingPath: p.headingPath,
          })),
        )
      })

      // embedding 步骤一期留桩（无 LLM 依赖），直接置 ready。
      await models.documents.setStatus(documentId, 'embedding')
      await models.documents.setStatus(documentId, 'ready')
      logger.info({ documentId, chunks: pieces.length }, 'ingest 完成')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ documentId, err }, 'ingest 失败')
      await models.documents.setStatus(documentId, 'failed', message).catch(() => undefined)
    }
  }

  async function parseFile(fileId: string): Promise<string> {
    const file = await models.files.findById(fileId)
    if (!file) throw new Error(`file 不存在: ${fileId}`)
    const buffer = await infra.storage.getObject(file.storage_key)
    const detected = await detectType(buffer)
    if (!SUPPORTED_KINDS.has(detected.kind)) {
      throw new Error(`不支持的文件类型: ${detected.mimeType}`)
    }
    const parser = getParser(detected.kind)
    const { markdown } = await parser.parse({
      buffer,
      mimeType: detected.mimeType,
      filename: file.original_name ?? undefined,
    })
    return markdown
  }

  async function createVersionFromParse(
    documentId: string,
    content: string,
    fileId: string,
    authorId: string,
  ): Promise<string> {
    const versionNo = await models.documentVersions.nextVersionNo(documentId)
    const version = await models.documentVersions.insert({
      id: uuidv7(),
      documentId,
      versionNo,
      content,
      checksum: sha256(content),
      sourceFileId: fileId,
      authorId,
    })
    return version.id
  }

  // 一期：collection 级 chunking 覆盖留接口，统一用默认参数。
  function resolveChunkParams(_collectionId: string): ChunkParams {
    return DEFAULT_CHUNK_PARAMS
  }

  return { run }
}

export * from './parsers/index.js'
export * from './chunker.js'
