<script setup lang="ts">
import { TabsList } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <TabsList
    :class="
      cn(
        'inline-flex items-center gap-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-1',
        props.class,
      )
    "
  >
    <slot />
  </TabsList>
</template>
