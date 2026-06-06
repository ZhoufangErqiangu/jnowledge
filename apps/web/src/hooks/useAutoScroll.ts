import { nextTick, ref, watch, type WatchSource } from 'vue'

/**
 * 自动滚到底：绑定容器 ref，监听给定数据源变化后在下一帧把 scrollTop 拉到底部。
 * 用于聊天消息流（消息数 / 流式草稿变化时跟随滚动）。
 */
export function useAutoScroll(sources: WatchSource[]) {
  const scroller = ref<HTMLElement | null>(null)
  function scrollToBottom() {
    nextTick(() => {
      const el = scroller.value
      if (el) el.scrollTop = el.scrollHeight
    })
  }
  watch(sources, scrollToBottom, { deep: true })
  return { scroller, scrollToBottom }
}
