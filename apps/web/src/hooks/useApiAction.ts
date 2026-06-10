import { toast } from 'vue-sonner'
import { ApiError } from '@/apis/http'

export function useApiAction() {
  async function run<T>(
    fn: () => Promise<T>,
    fallback = '操作失败',
    success?: string,
  ): Promise<T | undefined> {
    try {
      const r = await fn()
      if (success) toast.success(success)
      return r
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : fallback)
      return undefined
    }
  }
  return { run }
}
