<script setup lang="ts">
import { nextTick, ref } from 'vue'

defineProps<{
  parts: { before: string; hit: string; after: string } | null
  versionNo: number | null
}>()

const markEl = ref<HTMLElement | null>(null)
function scrollToHit() {
  nextTick(() => markEl.value?.scrollIntoView({ block: 'center' }))
}
defineExpose({ scrollToHit })
</script>

<template>
  <div>
    <p v-if="versionNo" class="text-xs text-white/40 mb-3">版本 v{{ versionNo }} 全文</p>
    <pre
      v-if="parts"
      class="text-sm text-white/80 whitespace-pre-wrap break-words leading-relaxed m-0 font-sans"
    >{{ parts.before }}<mark
        v-if="parts.hit"
        ref="markEl"
        class="bg-amber-400/30 text-amber-200 rounded px-0.5 not-italic"
      >{{ parts.hit }}</mark>{{ parts.after }}</pre>
    <div v-else class="flex items-center justify-center py-12 text-white/30 text-sm">
      暂无内容
    </div>
  </div>
</template>
