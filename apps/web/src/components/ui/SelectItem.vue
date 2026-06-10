<script setup lang="ts">
import { SelectItem, SelectItemText } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ value: string; class?: string }>()
</script>

<template>
  <SelectItem
    :value="value"
    :class="
      cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2',
        'text-sm text-white/80 outline-none',
        'hover:bg-white/[0.06] hover:text-white',
        'data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white',
        'data-[state=checked]:text-brand',
        props.class,
      )
    "
  >
    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
