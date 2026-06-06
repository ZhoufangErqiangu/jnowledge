import { ElMessage } from 'element-plus'
import { ApiError } from '@/apis/http'

/**
 * 收口「try/catch + ElMessage.error」管线：成功返回结果（可选 success 提示），失败弹出归一化错误并返回 undefined。
 * 替代散落在各页面的同款 try/catch（ApiError 取 message，其余走 fallback）。
 */
export function useApiAction() {
  async function run<T>(
    fn: () => Promise<T>,
    fallback = '操作失败',
    success?: string,
  ): Promise<T | undefined> {
    try {
      const r = await fn()
      if (success) ElMessage.success(success)
      return r
    } catch (e) {
      ElMessage.error(e instanceof ApiError ? e.message : fallback)
      return undefined
    }
  }
  return { run }
}
