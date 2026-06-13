<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, Search, Loader2 } from 'lucide-vue-next'
import type { SubAgentLane } from '@/stores/chat'
import { cn } from '@/lib/utils'
import MarkdownContent from '@/components/MarkdownContent.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import ToolTrace from '@/components/chat/ToolTrace.vue'

// 子 agent 自 A 起退化为「证据经纪人」（输出是给父的中间原料，非用户答案）：
// 故不再平级泳道呈现，而是收进父回合的一条折叠「检索过程」盘（默认折叠，可展开看轨迹/证据）。
const props = defineProps<{ subAgents: SubAgentLane[] }>()

const open = ref(false)
const running = computed(() => props.subAgents.some((s) => s.running))
</script>

<template>
  <div
    v-if="props.subAgents.length"
    class="mb-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
  >
    <button
      class="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] text-white/45 hover:text-white/65 transition-colors"
      @click="open = !open"
    >
      <span class="flex items-center gap-1.5">
        <Search :size="11" class="text-emerald-300/70" />
        检索过程（{{ props.subAgents.length }} 次）
        <Loader2 v-if="running" :size="11" class="text-emerald-300/70 animate-spin" />
      </span>
      <ChevronDown
        :size="11"
        :class="cn('transition-transform duration-200', open && 'rotate-180')"
      />
    </button>

    <div v-show="open" class="px-2.5 pb-2 space-y-2">
      <div
        v-for="lane in props.subAgents"
        :key="lane.runId"
        class="border-l-2 border-emerald-500/15 pl-2.5"
        :style="{ marginLeft: `${(lane.depth - 1) * 12}px` }"
      >
        <!-- 子助手名 + 在途 -->
        <div class="flex items-center gap-1.5 mb-1">
          <span class="text-[11px] font-medium text-emerald-300/90">{{ lane.agentName }}</span>
          <Loader2 v-if="lane.running" :size="10" class="text-emerald-300/70 animate-spin" />
        </div>

        <ReasoningPanel :reasoning="lane.reasoning" />
        <ToolTrace :tools="lane.tools" label="内部检索" />

        <!-- 证据要点（次要原料，弱化呈现） -->
        <div v-if="lane.text" class="text-[11px] text-white/40 leading-relaxed">
          <MarkdownContent :source="lane.text" />
        </div>
        <div v-else-if="lane.running" class="text-[11px] text-white/35">检索中…</div>
      </div>
    </div>
  </div>
</template>
