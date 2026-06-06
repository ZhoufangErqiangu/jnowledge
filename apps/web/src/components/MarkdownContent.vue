<script setup lang="ts">
import { renderMarkdown } from '@/utils/markdown'

// 共享 Markdown 渲染块：消息气泡、流式草稿等多处复用，统一承接 .md 排版样式。
defineProps<{ source: string }>()
</script>

<template>
  <div class="content md" v-html="renderMarkdown(source)" />
</template>

<style scoped lang="less">
/* 交给元素自身排版，去掉 pre-wrap 以免标签间多余空白 */
.content.md {
  white-space: normal;
  word-break: break-word;
  line-height: 1.6;
}
.content.md :deep(p) {
  margin: 0 0 8px;
}
.content.md :deep(p:last-child) {
  margin-bottom: 0;
}
.content.md :deep(h1),
.content.md :deep(h2),
.content.md :deep(h3),
.content.md :deep(h4) {
  margin: 12px 0 8px;
  font-size: 1.05em;
  font-weight: 600;
}
.content.md :deep(ul),
.content.md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}
.content.md :deep(li) {
  margin: 2px 0;
}
.content.md :deep(code) {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 0.92em;
  background: var(--el-fill-color-dark);
  padding: 1px 5px;
  border-radius: 4px;
}
.content.md :deep(pre) {
  background: var(--el-fill-color-darker);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
}
.content.md :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
}
.content.md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 0.95em;
}
.content.md :deep(th),
.content.md :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 5px 10px;
  text-align: left;
}
.content.md :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}
.content.md :deep(a) {
  color: var(--el-color-primary);
}
.content.md :deep(img) {
  max-width: 100%;
}
</style>
