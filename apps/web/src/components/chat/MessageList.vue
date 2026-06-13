<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'
import type { TurnView } from '@/stores/chat'
import { Sparkles } from 'lucide-vue-next'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import AssistantTurn from '@/components/chat/AssistantTurn.vue'
import SubAgentLaneView from '@/components/chat/SubAgentLane.vue'
import { useAutoScroll } from '@/hooks/useAutoScroll'

const props = defineProps<{
  turns: TurnView[]
  streaming: boolean
}>()
const emit = defineEmits<{ cite: [citation: Citation] }>()

const last = () => props.turns[props.turns.length - 1]
const { scroller } = useAutoScroll([
  () => props.turns.length,
  () => last()?.text,
  () => last()?.reasoning,
  () => last()?.subAgents.length,
  () => last()?.subAgents.map((s) => s.text.length + s.reasoning.length).join(','),
])

/** 顶层助手回合是否有可渲染内容（子 agent 泳道已平级独立渲染，不计入）。 */
function hasAssistant(t: TurnView): boolean {
  return !!(t.text || t.reasoning || t.streaming)
}
</script>

<template>
  <div ref="scroller" class="flex-1 overflow-y-auto px-1 py-2">
    <template v-for="t in turns" :key="t.runId">
      <MessageBubble v-if="t.user" :message="t.user" @cite="emit('cite', $event)" />
      <!-- 子 agent 参与方泳道（DESIGN §8.9 方案 B）：与顶层助手平级的独立发言方 -->
      <SubAgentLaneView
        v-for="lane in t.subAgents"
        :key="lane.runId"
        :lane="lane"
        @cite="emit('cite', $event)"
      />
      <AssistantTurn v-if="hasAssistant(t)" :turn="t" @cite="emit('cite', $event)" />
    </template>

    <div
      v-if="turns.length === 0 && !streaming"
      class="flex flex-col items-center justify-center h-full gap-4 text-white/30 py-16"
    >
      <div
        class="w-16 h-16 rounded-full bg-gradient-to-br from-brand/20 to-brand-violet/20 flex items-center justify-center"
      >
        <Sparkles :size="28" class="text-brand/50" />
      </div>
      <p class="text-sm text-center max-w-xs leading-relaxed">
        助手：自动选择相关知识库检索作答，并标注引用
      </p>
    </div>
  </div>
</template>
