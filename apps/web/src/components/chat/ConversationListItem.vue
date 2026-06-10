<script setup lang="ts">
import type { Conversation } from '@jnowledge/shared'
import { Trash2 } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

defineProps<{ conversation: Conversation; active: boolean }>()
const emit = defineEmits<{ select: []; remove: [] }>()
</script>

<template>
  <li
    :class="
      cn(
        'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer group',
        'transition-all duration-100',
        active ? 'bg-brand/20 text-white' : 'text-white/70 hover:bg-white/[0.05] hover:text-white',
      )
    "
    @click="emit('select')"
  >
    <span class="truncate text-sm flex-1">{{ conversation.title }}</span>
    <button
      class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-white/40 shrink-0"
      @click.stop="emit('remove')"
    >
      <Trash2 :size="13" />
    </button>
  </li>
</template>
