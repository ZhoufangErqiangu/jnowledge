<script setup lang="ts">
import { SelectTrigger, SelectValue, SelectIcon } from 'radix-vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{ placeholder?: string; class?: string }>()
</script>

<template>
  <SelectTrigger
    :class="
      cn(
        'flex h-9 w-full items-center justify-between rounded-md border border-white/[0.1]',
        'bg-white/[0.04] px-3 py-2 text-sm text-white/90 placeholder:text-white/30',
        'focus:outline-none focus:ring-1 focus:ring-brand/50 focus:border-brand/40',
        'disabled:opacity-50',
        'transition-all duration-150',
        props.class,
      )
    "
  >
    <SelectValue :placeholder="placeholder ?? '请选择'" />
    <SelectIcon>
      <ChevronDown class="h-4 w-4 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>
