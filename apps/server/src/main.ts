import './loadEnv.js'
import { loadConfig } from './config/index.js'
import { buildContainer } from './container.js'
import { createApp } from './app.js'
import { QUEUE_INGEST_DOCUMENT, type IngestDocumentJob } from './services/infra/jobs.js'

async function main() {
  const config = loadConfig()
  const c = buildContainer(config)

  // 确保对象存储 bucket 存在
  await c.infra.storage.ensureBucket()

  // 启动任务队列 + 注册摄取 worker（解析→分块→embedding 留桩）
  await c.infra.jobs.start()
  await c.infra.jobs.work<IngestDocumentJob>(QUEUE_INGEST_DOCUMENT, (data) =>
    c.services.ingestion.run(data),
  )

  const app = createApp(c)
  const server = app.listen(config.port, () => {
    c.logger.info({ port: config.port }, `jnowledge server 已启动 http://localhost:${config.port}`)
    c.logger.info(`API 文档: http://localhost:${config.port}/docs`)
  })

  // 优雅退出
  const shutdown = async (signal: string) => {
    c.logger.info({ signal }, '收到退出信号，正在关闭…')
    server.close()
    await c.infra.jobs.stop().catch(() => undefined)
    await c.db.destroy().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
   
  console.error('启动失败：', err)
  process.exit(1)
})
