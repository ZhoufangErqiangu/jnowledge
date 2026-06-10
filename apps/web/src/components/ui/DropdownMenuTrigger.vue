<script setup lang="ts">
import { DropdownMenuTrigger } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <DropdownMenuTrigger
    :class="cn('outline-none focus-visible:outline-none', props.class)"
  >
    <slot />
  </DropdownMenuTrigger>
</template>
