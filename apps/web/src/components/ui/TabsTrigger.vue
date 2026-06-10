<script setup lang="ts">
import { TabsTrigger } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ value: string; class?: string }>()
</script>

<template>
  <TabsTrigger
    :value="value"
    :class="
      cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
        'text-white/50 transition-all duration-150',
        'focus-visible:outline-none',
        'data-[state=active]:bg-brand data-[state=active]:text-white data-[state=active]:shadow-sm',
        'hover:text-white/80',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
