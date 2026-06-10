<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Send, Brain } from 'lucide-vue-next'
import { MAIN_REASONING_TIERS, type MainReasoningTier } from '@jnowledge/shared'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/ui/Select.vue'
import SelectTrigger from '@/components/ui/SelectTrigger.vue'
import SelectContent from '@/components/ui/SelectContent.vue'
import SelectItem from '@/components/ui/SelectItem.vue'

const text = defineModel<string>('modelValue', { required: true })
const tier = defineModel<MainReasoningTier>('tier', { required: true })
const thinking = defineModel<boolean>('thinking', { required: true })
defineProps<{ streaming: boolean; conversationId?: string | null }>()
const emit = defineEmits<{ send: [] }>()

// 主推理档位的中文标签（仅暴露 heavy/standard/light）。
const TIER_LABELS: Record<MainReasoningTier, string> = {
  heavy: '专业',
  standard: '标准',
  light: '快速',
}

// 自适应高度：单行时与发送按钮等高（h-8 = 32px），随内容增长至上限后内部滚动。
const MAX_HEIGHT = 160
const ta = ref<HTMLTextAreaElement>()
function autogrow() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
}
watch(text, () => nextTick(autogrow), { immediate: true })
</script>

<template>
  <div class="pt-3 border-t border-white/[0.06]">
    <!-- 主推理控制：模型档位 + thinking 开关（仅作用于顶层推理）。 -->
    <div class="flex items-center gap-2 pb-2">
      <Select v-model="tier">
        <SelectTrigger class="h-7 w-[112px] text-xs" />
        <SelectContent>
          <SelectItem v-for="t in MAIN_REASONING_TIERS" :key="t" :value="t">
            {{ TIER_LABELS[t] }}
          </SelectItem>
        </SelectContent>
      </Select>
      <button
        type="button"
        :class="[
          'inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs border transition-colors',
          thinking
            ? 'bg-brand/15 text-brand/90 border-brand/30'
            : 'bg-white/[0.03] text-white/40 border-white/[0.08] hover:text-white/60',
        ]"
        :aria-pressed="thinking"
        @click="thinking = !thinking"
      >
        <Brain :size="13" />
        思考
      </button>
      <router-link
        v-if="conversationId"
        :to="{ name: 'context-debug', params: { id: conversationId } }"
        class="ml-auto text-xs text-white/30 hover:text-white/50 transition-colors"
      >
        调试上下文
      </router-link>
    </div>

    <div
      class="relative flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] focus-within:border-brand/40 focus-within:shadow-[0_0_0_1px_rgba(99,102,241,0.12)] transition-all duration-200 px-2 py-2"
    >
      <textarea
        ref="ta"
        v-model="text"
        rows="1"
        placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
        class="flex-1 bg-transparent border-0 resize-none focus:outline-none text-white/90 placeholder:text-white/30 text-sm leading-6 py-1 px-1 max-h-40 overflow-y-auto"
        @keydown.enter.exact.prevent="emit('send')"
      />
      <Button size="sm" variant="gradient" :loading="streaming" class="h-8 px-3 shrink-0" @click="emit('send')">
        <Send v-if="!streaming" :size="14" />
      </Button>
    </div>
  </div>
</template>
