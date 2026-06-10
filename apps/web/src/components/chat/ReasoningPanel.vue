<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, BrainCircuit } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

defineProps<{ reasoning: string }>()

const open = ref(false)
</script>

<template>
  <div
    v-if="reasoning.trim()"
    class="mb-2 rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden"
  >
    <button
      class="w-full flex items-center justify-between px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors"
      @click="open = !open"
    >
      <span class="flex items-center gap-1.5">
        <BrainCircuit :size="12" class="text-brand/60" />
        思考过程
      </span>
      <ChevronDown
        :size="12"
        :class="cn('transition-transform duration-200', open && 'rotate-180')"
      />
    </button>
    <div v-show="open" class="px-3 pb-3">
      <pre
        class="text-xs text-white/40 whitespace-pre-wrap break-words leading-relaxed m-0 font-sans"
        >{{ reasoning }}</pre
      >
    </div>
  </div>
</template>
