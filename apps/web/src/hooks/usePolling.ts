import { onBeforeUnmount, watch, type WatchSource } from 'vue'

/**
 * 条件轮询：active 为真时每 interval 执行一次 fn，转假即停；组件卸载自动清理。
 * 用于「有处理中文档时定时刷新列表」这类按需轮询，免去页面里手写 timer 生命周期。
 */
export function usePolling(active: WatchSource<boolean>, fn: () => unknown, interval = 2000) {
  let timer: ReturnType<typeof setInterval> | null = null
  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  watch(active, (on) => {
    if (on && !timer) timer = setInterval(fn, interval)
    else if (!on) stop()
  })
  onBeforeUnmount(stop)
}
