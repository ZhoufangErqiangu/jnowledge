<script setup lang="ts">
import type { Document } from '@jnowledge/shared'
import { formatDate } from '@/utils/format'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'

defineProps<{ documents: Document[]; loading: boolean }>()
const emit = defineEmits<{ open: [doc: Document]; remove: [id: string] }>()
</script>

<template>
  <div>
    <!-- Skeleton loading -->
    <div v-if="loading" class="space-y-2">
      <SkeletonBlock v-for="i in 5" :key="i" class="h-12 w-full" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="documents.length === 0"
      class="flex items-center justify-center py-16 text-white/30 text-sm"
    >
      暂无文档
    </div>

    <!-- Table -->
    <div v-else class="rounded-xl border border-white/[0.06] overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-white/[0.06] bg-white/[0.02]">
            <th class="text-left px-4 py-3 text-white/50 font-medium">标题</th>
            <th class="text-left px-4 py-3 text-white/50 font-medium w-24">来源</th>
            <th class="text-left px-4 py-3 text-white/50 font-medium w-28">状态</th>
            <th class="text-left px-4 py-3 text-white/50 font-medium w-44">更新时间</th>
            <th class="w-20" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(doc, i) in documents"
            :key="doc.id"
            class="border-b border-white/[0.04] cursor-pointer hover:bg-brand/[0.04] transition-colors duration-100 group animate-fade-up"
            :style="{ animationDelay: `${i * 25}ms` }"
            @click="emit('open', doc)"
          >
            <td class="px-4 py-3 text-white/85 truncate max-w-xs">{{ doc.title }}</td>
            <td class="px-4 py-3 text-white/50">{{ doc.sourceType }}</td>
            <td class="px-4 py-3">
              <StatusBadge :status="doc.status" />
            </td>
            <td class="px-4 py-3 text-white/40 text-xs">{{ formatDate(doc.updatedAt) }}</td>
            <td class="px-4 py-3">
              <button
                class="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-red-400/70 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10"
                @click.stop="emit('remove', doc.id)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
