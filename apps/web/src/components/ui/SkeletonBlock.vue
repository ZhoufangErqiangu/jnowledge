<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('skeleton-shimmer rounded-md bg-white/[0.04]', props.class)" />
</template>
