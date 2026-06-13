<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'
import type { SubAgentLane } from '@/stores/chat'
import { Bot, Loader2 } from 'lucide-vue-next'
import MarkdownContent from '@/components/MarkdownContent.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import ToolTrace from '@/components/chat/ToolTrace.vue'

const props = defineProps<{ lane: SubAgentLane }>()
defineEmits<{ cite: [citation: Citation] }>()
</script>

<template>
  <div class="flex mb-5 animate-fade-up" :style="{ marginLeft: `${(props.lane.depth - 1) * 16}px` }">
    <!-- 子 agent 头像（区别于顶层助手的 K） -->
    <div
      class="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/80 to-teal-500/80 flex items-center justify-center text-white shrink-0 mr-2 mt-0.5 shadow-lg shadow-emerald-500/20"
    >
      <Bot :size="14" />
    </div>

    <div
      class="max-w-[76%] min-w-0 rounded-2xl rounded-tl-none px-4 py-3 bg-emerald-500/[0.04] border border-emerald-500/15 text-white/85"
    >
      <!-- 参与方标题行 -->
      <div class="flex items-center gap-1.5 mb-1.5">
        <span class="text-[11px] font-medium text-emerald-300/90">{{ lane.agentName }}</span>
        <Loader2 v-if="lane.running" :size="11" class="text-emerald-300/70 animate-spin" />
      </div>

      <ReasoningPanel :reasoning="lane.reasoning" />

      <!-- 内部工具轨迹（默认折叠） -->
      <ToolTrace :tools="lane.tools" label="内部检索" />

      <!-- 终答（默认展开） -->
      <div v-if="lane.text" class="text-sm leading-relaxed">
        <MarkdownContent :source="lane.text" /><span
          v-if="lane.running"
          class="caret-blink"
          >▍</span
        >
      </div>
      <div v-else-if="lane.running" class="text-[11px] text-white/35">检索中…</div>
    </div>
  </div>
</template>
