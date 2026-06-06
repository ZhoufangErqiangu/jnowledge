import { ElMessageBox } from 'element-plus'
import { useApiAction } from '@/hooks/useApiAction'

/**
 * 确认弹窗 + 执行删除。用户取消即静默返回；确认后复用 useApiAction 的错误处理。
 * 替代各页面重复的 ElMessageBox.confirm(...) + try/catch 删除逻辑。
 */
export function useConfirmDelete() {
  const { run } = useApiAction()
  async function confirmDelete(message: string, action: () => Promise<void>, fallback = '删除失败') {
    try {
      await ElMessageBox.confirm(message, '提示', { type: 'warning' })
    } catch {
      return // 用户取消
    }
    await run(action, fallback)
  }
  return { confirmDelete }
}
