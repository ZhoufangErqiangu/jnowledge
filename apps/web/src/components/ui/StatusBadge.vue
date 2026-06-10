<script setup lang="ts">
import type { DocumentStatus } from '@jnowledge/shared'
import { cn } from '@/lib/utils'

defineProps<{ status: DocumentStatus }>()

const CONFIG: Record<DocumentStatus, { label: string; cls: string }> = {
  ready:     { label: 'ready',     cls: 'bg-green-500/15 text-green-400 border-green-500/25' },
  failed:    { label: 'failed',    cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
  pending:   { label: 'pending',   cls: 'bg-gray-500/15 text-gray-400 border-gray-500/25' },
  parsing:   { label: 'parsing',   cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
  chunking:  { label: 'chunking',  cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
  embedding: { label: 'embedding', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' },
}
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        CONFIG[status]?.cls ?? 'bg-gray-500/15 text-gray-400 border-gray-500/25',
      )
    "
  >
    {{ CONFIG[status]?.label ?? status }}
  </span>
</template>
