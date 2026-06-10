<script setup lang="ts">
import type { Chunk } from '@jnowledge/shared'

defineProps<{ chunks: Chunk[]; versionNo: number | null }>()
</script>

<template>
  <div>
    <p v-if="versionNo" class="text-xs text-white/40 mb-3">版本 v{{ versionNo }} 的分块</p>
    <div v-if="chunks.length > 0" class="space-y-3">
      <div
        v-for="c in chunks"
        :key="c.id"
        class="rounded-xl border border-white/[0.06] bg-surface/60 p-4 hover:border-white/[0.1] transition-colors duration-150"
      >
        <div class="text-xs text-white/40 mb-2 font-mono">
          #{{ c.seq }} · {{ c.tokenCount }} tokens · [{{ c.charStart }}, {{ c.charEnd }})
          <span v-if="c.headingPath.length"> · {{ c.headingPath.join(' / ') }}</span>
        </div>
        <pre class="text-sm text-white/80 whitespace-pre-wrap break-words leading-relaxed m-0 font-sans">{{ c.content }}</pre>
      </div>
    </div>
    <div v-else class="flex items-center justify-center py-12 text-white/30 text-sm">
      暂无分块（可能还在处理中）
    </div>
  </div>
</template>
