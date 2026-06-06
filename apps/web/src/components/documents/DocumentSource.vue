<script setup lang="ts">
import { nextTick, ref } from 'vue'

// 原文（引用高亮）：按 before/hit/after 三段渲染，hit 命中区间高亮。
// 暴露 scrollToHit() 供父级在引用跳转时滚动定位。
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
  <p v-if="versionNo" class="page-muted">版本 v{{ versionNo }} 全文</p>
  <pre v-if="parts" class="source-body">{{ parts.before
    }}<mark v-if="parts.hit" ref="markEl">{{ parts.hit }}</mark>{{ parts.after }}</pre>
  <el-empty v-else description="暂无内容" />
</template>

<style scoped lang="less">
.source-body {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
  line-height: 1.7;
}
.source-body mark {
  background: var(--el-color-warning-light-5);
  border-radius: 3px;
  padding: 1px 2px;
}
</style>
