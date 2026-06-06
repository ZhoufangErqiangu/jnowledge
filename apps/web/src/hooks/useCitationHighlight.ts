import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import { useRoute } from 'vue-router'

/**
 * 引用高亮：解析 route.query.hl="start-end"，按精确 char 偏移把正文切成 before/hit/after 三段。
 * 与 useCitationNav 写入的 query 对应（一期精确偏移）。无 hl 时 hit 为空、整段为 before。
 */
export function useCitationHighlight(content: MaybeRefOrGetter<string | undefined>) {
  const route = useRoute()

  const highlight = computed(() => {
    const hl = route.query.hl as string | undefined
    if (!hl) return null
    const [s, e] = hl.split('-').map(Number)
    if (Number.isNaN(s) || Number.isNaN(e)) return null
    return { start: s, end: e }
  })

  const sourceParts = computed(() => {
    const text = toValue(content)
    if (!text) return null
    const h = highlight.value
    if (!h) return { before: text, hit: '', after: '' }
    return {
      before: text.slice(0, h.start),
      hit: text.slice(h.start, h.end),
      after: text.slice(h.end),
    }
  })

  return { highlight, sourceParts }
}
