<script setup lang="ts">
import { SelectPortal, SelectContent, SelectViewport } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <SelectPortal>
    <SelectContent
      :class="
        cn(
          'relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-white/[0.08]',
          'bg-surface shadow-xl shadow-black/40',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          props.class,
        )
      "
      position="popper"
      :side-offset="4"
    >
      <SelectViewport class="p-1">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
