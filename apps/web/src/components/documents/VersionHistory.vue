<script setup lang="ts">
import type { DocumentVersionSummary } from '@jnowledge/shared'
import { formatDate } from '@/utils/format'

// 版本历史表：行点击选择某版本（加载其全文/分块），选择以事件上抛。
defineProps<{ versions: DocumentVersionSummary[] }>()
const emit = defineEmits<{ select: [versionId: string] }>()
</script>

<template>
  <el-table
    :data="versions"
    size="small"
    @row-click="(r: DocumentVersionSummary) => emit('select', r.id)"
  >
    <el-table-column label="版本" prop="versionNo" width="80" />
    <el-table-column label="校验和" width="160">
      <template #default="{ row }">
        <code>{{ row.checksum.slice(0, 12) }}</code>
      </template>
    </el-table-column>
    <el-table-column label="来源">
      <template #default="{ row }">{{ row.sourceFileId ? '上传' : '手动编辑' }}</template>
    </el-table-column>
    <el-table-column label="时间" width="180">
      <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
    </el-table-column>
  </el-table>
</template>
