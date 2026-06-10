import { ref } from 'vue'

interface ConfirmState {
  message: string
  resolve: (confirmed: boolean) => void
}

export const confirmState = ref<ConfirmState | null>(null)

export function useConfirmDialog() {
  function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmState.value = { message, resolve }
    })
  }
  return { confirm }
}
