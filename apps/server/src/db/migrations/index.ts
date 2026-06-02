import type { Migration } from 'kysely'
import * as init from './001_init.js'

/**
 * 显式迁移注册表（不做目录扫描，与全仓"显式注册"约定一致）。
 * 新增迁移 = import 一行 + 在此对象加一项；键名决定执行顺序（字典序）。
 */
export const migrations: Record<string, Migration> = {
  '001_init': init,
}
