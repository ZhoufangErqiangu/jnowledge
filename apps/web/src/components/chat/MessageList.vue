<script setup lang="ts">
import type { Citation, Message } from '@jnowledge/shared'
import type { TraceStep } from '@/stores/chat'
import { Sparkles } from 'lucide-vue-next'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import StreamingBubble from '@/components/chat/StreamingBubble.vue'
import { useAutoScroll } from '@/hooks/useAutoScroll'

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
  <div ref="scroller" class="flex-1 overflow-y-auto px-1 py-2">
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

    <div
      v-if="messages.length === 0 && !streaming"
      class="flex flex-col items-center justify-center h-full gap-4 text-white/30 py-16"
    >
      <div
        class="w-16 h-16 rounded-full bg-gradient-to-br from-brand/20 to-brand-violet/20 flex items-center justify-center"
      >
        <Sparkles :size="28" class="text-brand/50" />
      </div>
      <p class="text-sm text-center max-w-xs leading-relaxed">
        全局助手：自动选择相关知识库检索作答，并标注引用
      </p>
    </div>
  </div>
</template>
