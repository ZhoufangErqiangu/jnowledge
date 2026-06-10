<script setup lang="ts">
import { computed } from 'vue'
import { AvatarRoot, AvatarImage, AvatarFallback } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ name?: string | null; src?: string | null; class?: string }>()

const initials = computed(() => {
  const source = (props.name ?? '').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase()
  return source.slice(0, 2).toUpperCase()
})
</script>

<template>
  <AvatarRoot
    :class="
      cn(
        'inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full select-none',
        'h-8 w-8 bg-brand/20 text-brand text-xs font-semibold',
        props.class,
      )
    "
  >
    <AvatarImage v-if="src" :src="src" class="h-full w-full object-cover" />
    <AvatarFallback class="flex h-full w-full items-center justify-center">
      {{ initials }}
    </AvatarFallback>
  </AvatarRoot>
</template>
