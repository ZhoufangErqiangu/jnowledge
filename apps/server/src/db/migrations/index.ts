import type { Migration } from 'kysely'
import * as init from './001_init.js'
import * as rag from './002_rag.js'
import * as agent from './003_agent.js'
import * as globalChat from './004_global_chat.js'
import * as pendingOps from './005_pending_operations.js'
import * as contextItems from './006_context_items.js'
import * as dropLegacyLogs from './007_drop_legacy_logs.js'
import * as runTree from './008_run_tree.js'
import * as seedAdmin from './009_seed_admin.js'

/**
 * 显式迁移注册表（不做目录扫描，与全仓"显式注册"约定一致）。
 * 新增迁移 = import 一行 + 在此对象加一项；键名决定执行顺序（字典序）。
 */
export const migrations: Record<string, Migration> = {
  '001_init': init,
  '002_rag': rag,
  '003_agent': agent,
  '004_global_chat': globalChat,
  '005_pending_operations': pendingOps,
  '006_context_items': contextItems,
  '007_drop_legacy_logs': dropLegacyLogs,
  '008_run_tree': runTree,
  '009_seed_admin': seedAdmin,
}
