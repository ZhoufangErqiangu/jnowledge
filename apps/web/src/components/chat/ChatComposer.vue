<script setup lang="ts">
import { Send } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

const text = defineModel<string>({ required: true })
defineProps<{ streaming: boolean }>()
const emit = defineEmits<{ send: [] }>()
</script>

<template>
  <div class="pt-3 border-t border-white/[0.06]">
    <div
      class="relative flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] focus-within:border-brand/40 focus-within:shadow-[0_0_0_1px_rgba(99,102,241,0.12)] transition-all duration-200 px-3 py-2"
    >
      <textarea
        v-model="text"
        rows="2"
        placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
        class="flex-1 bg-transparent border-0 resize-none focus:outline-none text-white/90 placeholder:text-white/30 text-sm leading-relaxed"
        @keydown.enter.exact.prevent="emit('send')"
      />
      <div class="flex flex-col items-center gap-1.5 pb-0.5 shrink-0">
        <span
          class="text-[10px] px-1.5 py-0.5 rounded bg-brand/15 text-brand/80 border border-brand/20 font-medium"
        >
          Agent
        </span>
        <Button size="sm" variant="gradient" :loading="streaming" class="h-8 px-3" @click="emit('send')">
          <Send v-if="!streaming" :size="14" />
        </Button>
      </div>
    </div>
  </div>
</template>
