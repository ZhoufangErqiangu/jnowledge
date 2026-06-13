<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'
import type { TurnView } from '@/stores/chat'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import ToolTrace from '@/components/chat/ToolTrace.vue'
import AgentTrace from '@/components/chat/AgentTrace.vue'

defineProps<{ turn: TurnView }>()
const emit = defineEmits<{ cite: [citation: Citation] }>()
</script>

<template>
  <div class="flex mb-5 animate-fade-up">
    <!-- 顶层助手头像 -->
    <div
      class="w-7 h-7 rounded-full bg-gradient-to-br from-brand to-brand-violet flex items-center justify-center text-white text-xs font-bold shrink-0 mr-2 mt-0.5 shadow-lg shadow-brand/30"
    >
      K
    </div>

    <div
      class="max-w-[76%] rounded-2xl rounded-tl-none px-4 py-3 bg-surface border border-white/[0.07] text-white/90 shadow-md"
    >
      <ReasoningPanel :reasoning="turn.reasoning" />

      <!-- 顶层 agent 自身的工具轨迹（默认折叠） -->
      <ToolTrace :tools="turn.tools" />

      <!-- 子 agent 检索过程（默认折叠，DESIGN §8.9 修订：证据经纪人不再平级泳道） -->
      <AgentTrace :sub-agents="turn.subAgents" />

      <!-- 顶层终答 -->
      <div v-if="turn.text || turn.streaming" class="inline mt-1">
        <MarkdownContent :source="turn.text" /><span v-if="turn.streaming" class="caret-blink"
          >▍</span
        >
      </div>
      <CitationTags :citations="turn.citations" @select="emit('cite', $event)" />
    </div>
  </div>
</template>
