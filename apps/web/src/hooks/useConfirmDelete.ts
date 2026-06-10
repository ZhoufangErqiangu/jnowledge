import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useApiAction } from '@/hooks/useApiAction'

export function useConfirmDelete() {
  const { confirm } = useConfirmDialog()
  const { run } = useApiAction()

  async function confirmDelete(message: string, action: () => Promise<void>, fallback = '删除失败') {
    const ok = await confirm(message)
    if (!ok) return
    await run(action, fallback)
  }

  return { confirmDelete }
}
