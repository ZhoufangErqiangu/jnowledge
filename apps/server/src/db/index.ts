import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Config } from '../config/index.js'
import type { Database } from './types.js'

export type DB = Kysely<Database>

/** 把 pg 的 numeric/int8 解析成 JS number（一期规模无大整数溢出风险）。 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => parseInt(v, 10))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => parseFloat(v))

export function createDb(config: Config): DB {
  const pool = new pg.Pool({ connectionString: config.database.url, max: 10 })
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}
