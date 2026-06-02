import PgBoss from 'pg-boss'
import type { Config } from '../../config/index.js'
import type { Logger } from '../../logger.js'

/** 一期唯一的队列：文档摄取流水线。 */
export const QUEUE_INGEST_DOCUMENT = 'ingest-document'

export interface IngestDocumentJob {
  documentId: string
  /** 上传路径：解析文件后由 worker 创建版本，故初始可空。 */
  fileId?: string | null
  /** 手动路径：版本已同步创建，传其 id 供 worker 重新分块。 */
  versionId?: string
}

/**
 * pg-boss 任务队列骨架（Postgres 原生，不引 Redis）。
 * 串「解析→分块→embedding(一期留桩)」，由 documents.status 驱动。
 */
export interface JobQueue {
  start(): Promise<void>
  stop(): Promise<void>
  /** 注册 worker。handler 抛错 → pg-boss 按策略重试/进死信。 */
  work<T extends object>(queue: string, handler: (data: T) => Promise<void>): Promise<void>
  enqueue<T extends object>(queue: string, data: T): Promise<void>
}

export function createJobQueue(config: Config, logger: Logger): JobQueue {
  const boss = new PgBoss({ connectionString: config.database.url })
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))

  return {
    async start() {
      await boss.start()
      // 确保队列存在（pg-boss v10 需显式创建队列）
      await boss.createQueue(QUEUE_INGEST_DOCUMENT)
      logger.info('job queue started')
    },

    async stop() {
      await boss.stop({ graceful: true })
    },

    async work(queue, handler) {
      await boss.work(queue, async (jobs) => {
        for (const job of jobs) {
          await handler(job.data as Parameters<typeof handler>[0])
        }
      })
    },

    async enqueue(queue, data) {
      await boss.send(queue, data)
    },
  }
}
