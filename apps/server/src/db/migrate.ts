import '../loadEnv.js'
import { Migrator, type MigrationProvider } from 'kysely'
import { loadConfig } from '../config/index.js'
import { createDb } from './index.js'
import type { Database } from '../models/schema.js'
import { migrations } from './migrations/index.js'

/** 把显式注册表喂给 Kysely Migrator（替代 FileMigrationProvider 的目录扫描）。 */
const provider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

async function main() {
  const direction = process.argv[2] ?? 'up'
  const config = loadConfig()
  const db = createDb<Database>(config)
  const migrator = new Migrator({ db, provider })

  const { error, results } =
    direction === 'down'
      ? await migrator.migrateDown()
      : direction === 'latest' || direction === 'up'
        ? await migrator.migrateToLatest()
        : (() => {
            throw new Error(`未知迁移方向: ${direction}（用 up | down | latest）`)
          })()

  for (const r of results ?? []) {
    const tag = r.status === 'Success' ? '✓' : r.status === 'Error' ? '✗' : '·'
     
    console.log(`${tag} ${r.direction} ${r.migrationName} — ${r.status}`)
  }

  if (error) {

    console.error('迁移失败：', error)
    await db.destroy()
    process.exit(1)
  }

  await db.destroy()
}

void main()
