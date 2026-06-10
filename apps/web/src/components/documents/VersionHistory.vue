<script setup lang="ts">
import type { DocumentVersionSummary } from '@jnowledge/shared'
import { formatDate } from '@/utils/format'

defineProps<{ versions: DocumentVersionSummary[] }>()
const emit = defineEmits<{ select: [versionId: string] }>()
</script>

<template>
  <div v-if="versions.length > 0" class="rounded-xl border border-white/[0.06] overflow-hidden">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-white/[0.06] bg-white/[0.02]">
          <th class="text-left px-4 py-3 text-white/50 font-medium w-20">版本</th>
          <th class="text-left px-4 py-3 text-white/50 font-medium w-40">校验和</th>
          <th class="text-left px-4 py-3 text-white/50 font-medium">来源</th>
          <th class="text-left px-4 py-3 text-white/50 font-medium w-44">时间</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="v in versions"
          :key="v.id"
          class="border-b border-white/[0.04] cursor-pointer hover:bg-brand/[0.04] transition-colors duration-100"
          @click="emit('select', v.id)"
        >
          <td class="px-4 py-3 text-white/80 font-medium">v{{ v.versionNo }}</td>
          <td class="px-4 py-3">
            <code class="font-mono text-xs text-white/50">{{ v.checksum.slice(0, 12) }}</code>
          </td>
          <td class="px-4 py-3 text-white/60">{{ v.sourceFileId ? '上传' : '手动编辑' }}</td>
          <td class="px-4 py-3 text-white/40 text-xs">{{ formatDate(v.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div v-else class="flex items-center justify-center py-12 text-white/30 text-sm">暂无版本历史</div>
</template>
