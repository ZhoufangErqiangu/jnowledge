<script setup lang="ts">
import { DropdownMenuPortal, DropdownMenuContent } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string; align?: 'start' | 'center' | 'end' }>()
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      :align="align ?? 'end'"
      :side-offset="6"
      :class="
        cn(
          'z-50 min-w-[12rem] overflow-hidden rounded-lg border border-white/[0.08] p-1',
          'bg-surface shadow-xl shadow-black/40',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          props.class,
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
