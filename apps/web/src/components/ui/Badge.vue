<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{
  variant?: 'default' | 'info' | 'success' | 'warning' | 'danger'
  class?: string
}>()
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        props.variant === 'info' || !props.variant
          ? 'bg-brand/15 text-brand/90 border-brand/25'
          : props.variant === 'success'
            ? 'bg-green-500/15 text-green-400 border-green-500/25'
            : props.variant === 'warning'
              ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
              : 'bg-red-500/15 text-red-400 border-red-500/25',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
