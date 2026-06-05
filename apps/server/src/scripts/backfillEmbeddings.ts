import '../loadEnv.js'
import { loadConfig } from '../config/index.js'
import { buildContainer } from '../container.js'

/**
 * 存量重建：给一期已入库（无向量）的文档补 embedding，不重跑解析/分块。
 * 用法：pnpm --filter @jnowledge/server embed:backfill [limit]
 */
async function main() {
  const config = loadConfig()
  const c = buildContainer(config)
  if (!c.infra.llm.embedding.configured) {
    c.logger.error('embedding 供应商未配置（设置 SILICONFLOW_API_KEY），无法重建')
    process.exit(1)
  }
  const limit = Number(process.argv[2] ?? 50)
  let total = 0
  // 循环直到无可补版本（每轮取 limit 个）。
  for (;;) {
    const { versions, chunks } = await c.services.ingestion.embedding.backfillMissing({ limit })
    total += chunks
    c.logger.info({ versions, chunks }, 'backfill 一轮完成')
    if (versions === 0) break
  }
  c.logger.info({ total }, 'backfill 全部完成')
  await c.db.destroy()
  process.exit(0)
}

main().catch((err) => {
  console.error('backfill 失败：', err)
  process.exit(1)
})
