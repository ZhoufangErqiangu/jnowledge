<script setup lang="ts">
import { DropdownMenuSeparator } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <DropdownMenuSeparator :class="cn('my-1 h-px bg-white/[0.06]', props.class)" />
</template>
