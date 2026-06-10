<script setup lang="ts">
import { renderMarkdown } from '@/utils/markdown'

defineProps<{ source: string }>()
</script>

<template>
  <div class="content md" v-html="renderMarkdown(source)" />
</template>

<style scoped>
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
  color: rgba(255, 255, 255, 0.95);
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
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(147, 152, 255, 0.9);
  padding: 1px 5px;
  border-radius: 4px;
}
.content.md :deep(pre) {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
  color: rgba(255, 255, 255, 0.8);
}
.content.md :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 2px solid rgba(99, 102, 241, 0.4);
  color: rgba(255, 255, 255, 0.5);
  font-style: italic;
}
.content.md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 0.95em;
  width: 100%;
}
.content.md :deep(th),
.content.md :deep(td) {
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 5px 10px;
  text-align: left;
}
.content.md :deep(th) {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}
.content.md :deep(a) {
  color: #6366f1;
  text-decoration: none;
}
.content.md :deep(a:hover) {
  color: #8b5cf6;
  text-decoration: underline;
}
.content.md :deep(img) {
  max-width: 100%;
}
.content.md :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 12px 0;
}
</style>
