<script setup lang="ts">
import type { Citation, Message } from '@jnowledge/shared'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import { formatDate } from '@/utils/format'

// 单条已落库消息：用户消息纯文本，助手消息按 Markdown 渲染并带引用。
defineProps<{ message: Message }>()
const emit = defineEmits<{ cite: [citation: Citation] }>()
</script>

<template>
  <div class="msg" :class="message.role">
    <div class="bubble">
      <MarkdownContent v-if="message.role === 'assistant'" :source="message.content" />
      <div v-else class="content">{{ message.content }}</div>
      <CitationTags :citations="message.citations" @select="emit('cite', $event)" />
      <div class="ts page-muted">{{ formatDate(message.createdAt) }}</div>
    </div>
  </div>
</template>

<style scoped lang="less">
.msg {
  display: flex;
  margin-bottom: 14px;
}
.msg.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.msg.user .bubble {
  background: var(--el-color-primary-light-9);
}
.content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.ts {
  font-size: 11px;
  margin-top: 6px;
}
</style>
