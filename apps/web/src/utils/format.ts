import type { DocumentStatus } from '@jnowledge/shared'

/** 文档状态 → Element tag 主题色。 */
export function statusTagType(
  status: DocumentStatus,
): 'success' | 'danger' | 'info' | 'warning' | 'primary' {
  switch (status) {
    case 'ready':
      return 'success'
    case 'failed':
      return 'danger'
    case 'pending':
      return 'info'
    default:
      return 'warning' // parsing / chunking / embedding 处理中
  }
}

/** 非终态（处理中）→ 用于决定是否轮询刷新。 */
export function isProcessing(status: DocumentStatus): boolean {
  return status !== 'ready' && status !== 'failed'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}
