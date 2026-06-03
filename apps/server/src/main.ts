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

  // 优雅退出。重点是「确保端口被释放」——tsx watch 重启用 SIGTERM，SSE 是长连接，
  // 必须主动断开（closeAllConnections）否则 server.close 永不完成、旧进程占着 3000 变孤儿。
  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return // 防重入（重启时可能连发多个信号）
    closing = true
    c.logger.info({ signal }, '收到退出信号，正在关闭…')

    // 无论清理是否卡住，到点强制退出，绝不把端口留给下次启动。
    const force = setTimeout(() => {
      c.logger.warn('优雅关闭超时，强制退出')
      process.exit(0)
    }, 3000)
    force.unref()

    server.close()
    server.closeAllConnections() // 立即断开 SSE / keep-alive 连接，使 close 尽快完成
    await c.infra.jobs.stop().catch(() => undefined)
    await c.db.destroy().catch(() => undefined)
    process.exit(0)
  }
  // SIGHUP 覆盖「关闭终端」；SIGINT=Ctrl-C；SIGTERM=tsx watch 重启 / kill。
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => void shutdown(sig))
  }
}

main().catch((err) => {
  console.error('启动失败：', err)
  process.exit(1)
})
