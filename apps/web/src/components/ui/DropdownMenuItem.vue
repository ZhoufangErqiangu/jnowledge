<script setup lang="ts">
import { DropdownMenuItem } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <DropdownMenuItem
    :class="
      cn(
        'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5',
        'text-sm text-white/80 outline-none',
        'data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-white',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
