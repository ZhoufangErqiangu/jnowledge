<script setup lang="ts">
import type { Citation, Message } from '@jnowledge/shared'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import { formatDate } from '@/utils/format'
import { cn } from '@/lib/utils'

defineProps<{ message: Message }>()
const emit = defineEmits<{ cite: [citation: Citation] }>()
</script>

<template>
  <div :class="cn('flex mb-5 animate-fade-up', message.role === 'user' && 'justify-end')">
    <!-- AI avatar -->
    <div
      v-if="message.role === 'assistant'"
      class="w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-violet flex items-center justify-center text-white text-xs font-bold shrink-0 mr-2 mt-0.5 shadow-lg shadow-brand/30"
    >
      K
    </div>

    <div
      :class="
        cn(
          'max-w-[76%] rounded-2xl px-4 py-3',
          message.role === 'user'
            ? 'bg-gradient-to-br from-brand to-brand-violet text-white rounded-br-sm shadow-lg shadow-brand/20'
            : 'bg-surface border border-white/[0.07] text-white/90 rounded-bl-sm shadow-md',
        )
      "
    >
      <ReasoningPanel
        v-if="message.role === 'assistant' && message.reasoning"
        :reasoning="message.reasoning"
      />
      <MarkdownContent v-if="message.role === 'assistant'" :source="message.content" />
      <div v-else class="whitespace-pre-wrap break-words leading-relaxed text-sm">
        {{ message.content }}
      </div>
      <CitationTags :citations="message.citations" @select="emit('cite', $event)" />
      <div
        :class="
          cn(
            'text-[10px] mt-2',
            message.role === 'user' ? 'text-white/60' : 'text-white/30',
          )
        "
      >
        {{ formatDate(message.createdAt) }}
      </div>
    </div>
  </div>
</template>
