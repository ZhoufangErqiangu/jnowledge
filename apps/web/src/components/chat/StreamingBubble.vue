<script setup lang="ts">
import { ref } from 'vue'
import type { Citation } from '@jnowledge/shared'
import type { TraceStep } from '@/stores/chat'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

defineProps<{
  text: string
  reasoning: string
  citations: Citation[]
  steps: TraceStep[]
}>()
const emit = defineEmits<{ cite: [citation: Citation] }>()

const traceOpen = ref(true)

function stepBadgeCls(s: TraceStep) {
  if (s.running) return 'bg-blue-500/15 text-blue-400 border-blue-500/25'
  if (s.ok) return 'bg-green-500/15 text-green-400 border-green-500/25'
  return 'bg-red-500/15 text-red-400 border-red-500/25'
}
</script>

<template>
  <div class="flex mb-5">
    <!-- AI avatar -->
    <div
      class="w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-violet flex items-center justify-center text-white text-xs font-bold shrink-0 mr-2 mt-0.5 shadow-lg shadow-brand/30"
    >
      K
    </div>

    <div
      class="max-w-[76%] rounded-2xl rounded-bl-sm px-4 py-3 bg-surface border border-white/[0.07] text-white/90 shadow-md"
    >
      <!-- Agent execution trace -->
      <div
        v-if="steps.length"
        class="mb-2 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors"
          @click="traceOpen = !traceOpen"
        >
          <span>执行轨迹（{{ steps.length }} 步）</span>
          <ChevronDown
            :size="12"
            :class="cn('transition-transform duration-200', traceOpen && 'rotate-180')"
          />
        </button>
        <div v-show="traceOpen" class="px-3 pb-2 space-y-1.5">
          <div v-for="s in steps" :key="s.seq" class="flex items-center gap-2">
            <span
              :class="
                cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                  stepBadgeCls(s),
                  s.kind === 'agent' && 'ring-1 ring-white/10',
                )
              "
            >
              {{ s.kind === 'agent' ? '🤖 子agent' : '🔧 工具' }}:{{ s.name }}
            </span>
            <span class="text-xs text-white/40 truncate">
              {{ s.running ? '执行中…' : s.summary }}
            </span>
          </div>
        </div>
      </div>

      <ReasoningPanel :reasoning="reasoning" />
      <div class="inline">
        <MarkdownContent :source="text" /><span class="caret-blink">▍</span>
      </div>
      <CitationTags :citations="citations" @select="emit('cite', $event)" />
    </div>
  </div>
</template>
