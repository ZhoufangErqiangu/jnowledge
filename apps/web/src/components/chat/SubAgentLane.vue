<script setup lang="ts">
import { ref } from 'vue'
import type { Citation } from '@jnowledge/shared'
import type { SubAgentLane } from '@/stores/chat'
import { ChevronDown, Bot, Loader2 } from 'lucide-vue-next'
import MarkdownContent from '@/components/MarkdownContent.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ lane: SubAgentLane }>()
defineEmits<{ cite: [citation: Citation] }>()

// 内部工具默认折叠；终答默认展开（方案 B 选定）。
const toolsOpen = ref(false)
</script>

<template>
  <div class="flex mt-2" :style="{ marginLeft: `${(props.lane.depth - 1) * 16}px` }">
    <!-- 子 agent 头像（区别于顶层助手的 K） -->
    <div
      class="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500/80 to-teal-500/80 flex items-center justify-center text-white shrink-0 mr-2 mt-0.5 shadow shadow-emerald-500/20"
    >
      <Bot :size="13" />
    </div>

    <div
      class="flex-1 min-w-0 rounded-xl rounded-bl-sm px-3 py-2 bg-emerald-500/[0.04] border border-emerald-500/15 text-white/85"
    >
      <!-- 参与方标题行 -->
      <div class="flex items-center gap-1.5 mb-1.5">
        <span class="text-[11px] font-medium text-emerald-300/90">{{ lane.agentName }}</span>
        <Loader2 v-if="lane.running" :size="11" class="text-emerald-300/70 animate-spin" />
      </div>

      <ReasoningPanel :reasoning="lane.reasoning" />

      <!-- 内部工具轨迹（默认折叠） -->
      <div
        v-if="lane.tools.length"
        class="mb-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] text-white/45 hover:text-white/65 transition-colors"
          @click="toolsOpen = !toolsOpen"
        >
          <span>内部检索（{{ lane.tools.length }} 次）</span>
          <ChevronDown
            :size="11"
            :class="cn('transition-transform duration-200', toolsOpen && 'rotate-180')"
          />
        </button>
        <div v-show="toolsOpen" class="px-2.5 pb-1.5 space-y-1">
          <div v-for="(t, i) in lane.tools" :key="i" class="flex items-center gap-1.5">
            <span
              :class="
                cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                  t.ok
                    ? 'bg-green-500/15 text-green-400 border-green-500/25'
                    : 'bg-red-500/15 text-red-400 border-red-500/25',
                )
              "
            >
              🔧 {{ t.name }}
            </span>
            <span class="text-[11px] text-white/40 truncate">{{ t.summary }}</span>
          </div>
        </div>
      </div>

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
