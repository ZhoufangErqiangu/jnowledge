<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    tools: { name: string; ok: boolean; summary: string }[]
    /** 折叠标题前缀（顶层「工具调用」/ 子 agent「内部检索」）。 */
    label?: string
  }>(),
  { label: '工具调用' },
)

// 默认折叠（轨迹是次要信息）。
const open = ref(false)
</script>

<template>
  <div
    v-if="props.tools.length"
    class="mb-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
  >
    <button
      class="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] text-white/45 hover:text-white/65 transition-colors"
      @click="open = !open"
    >
      <span>{{ props.label }}（{{ props.tools.length }} 次）</span>
      <ChevronDown
        :size="11"
        :class="cn('transition-transform duration-200', open && 'rotate-180')"
      />
    </button>
    <div v-show="open" class="px-2.5 pb-1.5 space-y-1">
      <div v-for="(t, i) in props.tools" :key="i" class="flex items-center gap-1.5">
        <span
          :class="
            cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0',
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
</template>
