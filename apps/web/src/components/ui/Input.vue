<script setup lang="ts">
import { cn } from '@/lib/utils'

const model = defineModel<string>()

const props = defineProps<{
  type?: string
  placeholder?: string
  disabled?: boolean
  class?: string
}>()
</script>

<template>
  <input
    v-model="model"
    :type="type ?? 'text'"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-white/[0.1] bg-white/[0.04]',
        'px-3 py-1 text-sm text-white/90 placeholder:text-white/30',
        'focus:outline-none focus:ring-1 focus:ring-brand/50 focus:border-brand/40',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'transition-all duration-150',
        props.class,
      )
    "
  />
</template>
