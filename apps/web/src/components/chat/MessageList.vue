<script setup lang="ts">
import type { Citation, Message } from '@jnowledge/shared'
import type { TraceStep } from '@/stores/chat'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import StreamingBubble from '@/components/chat/StreamingBubble.vue'
import { useAutoScroll } from '@/hooks/useAutoScroll'

// 消息滚动区：已落库消息列表 + 流式期间末尾草稿气泡 + 空态。自身随消息/流式变化滚到底。
const props = defineProps<{
  messages: Message[]
  streaming: boolean
  streamText: string
  streamReasoning: string
  streamCitations: Citation[]
  streamSteps: TraceStep[]
}>()
const emit = defineEmits<{ cite: [citation: Citation] }>()

const { scroller } = useAutoScroll([
  () => props.messages.length,
  () => props.streamText,
  () => props.streamReasoning,
  () => props.streamSteps.length,
])
</script>

<template>
  <div ref="scroller" class="msg-scroll">
    <MessageBubble
      v-for="m in messages"
      :key="m.id"
      :message="m"
      @cite="emit('cite', $event)"
    />

    <StreamingBubble
      v-if="streaming"
      :text="streamText"
      :reasoning="streamReasoning"
      :citations="streamCitations"
      :steps="streamSteps"
      @cite="emit('cite', $event)"
    />

    <el-empty
      v-if="messages.length === 0 && !streaming"
      description="全局助手：自动选择相关知识库检索作答，并标注引用"
    />
  </div>
</template>

<style scoped lang="less">
.msg-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 6px;
}
</style>
