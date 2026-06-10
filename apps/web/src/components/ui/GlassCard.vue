<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{ hover?: boolean; class?: string }>()
</script>

<template>
  <div
    :class="
      cn(
        'rounded-xl border border-white/[0.06] bg-surface/80 backdrop-blur-md',
        'shadow-[0_0_0_1px_rgba(99,102,241,0.06),0_4px_24px_rgba(0,0,0,0.4)]',
        'transition-shadow duration-200',
        props.hover &&
          'hover:shadow-[0_0_0_1px_rgba(99,102,241,0.18),0_4px_32px_rgba(0,0,0,0.5)]',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
