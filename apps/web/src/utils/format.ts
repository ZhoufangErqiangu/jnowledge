import type { DocumentStatus } from '@jnowledge/shared'

/** 非终态（处理中）→ 用于决定是否轮询刷新。 */
export function isProcessing(status: DocumentStatus): boolean {
  return status !== 'ready' && status !== 'failed'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}
