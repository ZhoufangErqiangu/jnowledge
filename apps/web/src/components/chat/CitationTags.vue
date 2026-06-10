<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'

defineProps<{ citations: Citation[] }>()
const emit = defineEmits<{ select: [citation: Citation] }>()
</script>

<template>
  <div v-if="citations.length" class="mt-2 flex flex-wrap gap-1.5">
    <button
      v-for="c in citations"
      :key="c.marker"
      class="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-brand/15 text-brand/90 border border-brand/25 hover:bg-brand/25 hover:border-brand/40 transition-all duration-150 cursor-pointer"
      @click="emit('select', c)"
    >
      [{{ c.marker }}] {{ c.documentTitle }}
    </button>
  </div>
</template>
