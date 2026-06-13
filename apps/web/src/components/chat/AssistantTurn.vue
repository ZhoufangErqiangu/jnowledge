<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'
import type { TurnView } from '@/stores/chat'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import SubAgentLaneView from '@/components/chat/SubAgentLane.vue'

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
      class="max-w-[76%] rounded-2xl rounded-bl-sm px-4 py-3 bg-surface border border-white/[0.07] text-white/90 shadow-md"
    >
      <ReasoningPanel :reasoning="turn.reasoning" />

      <!-- 子 agent 参与方泳道（DESIGN §8.9 方案 B）：被顶层助手触发的发言方，历史与在途同一渲染 -->
      <SubAgentLaneView
        v-for="lane in turn.subAgents"
        :key="lane.runId"
        :lane="lane"
        @cite="emit('cite', $event)"
      />

      <!-- 顶层终答 -->
      <div v-if="turn.text || !turn.subAgents.length" class="inline mt-1">
        <MarkdownContent :source="turn.text" /><span v-if="turn.streaming" class="caret-blink"
          >▍</span
        >
      </div>
      <CitationTags :citations="turn.citations" @select="emit('cite', $event)" />
    </div>
  </div>
</template>
