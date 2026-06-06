<script setup lang="ts">
import type { Document } from '@jnowledge/shared'
import { formatDate, statusTagType } from '@/utils/format'

// 文档表格：纯展示，行点击打开详情、删除以事件上抛。
defineProps<{ documents: Document[]; loading: boolean }>()
const emit = defineEmits<{ open: [doc: Document]; remove: [id: string] }>()
</script>

<template>
  <div>
    <el-table v-loading="loading" :data="documents" @row-click="(row: Document) => emit('open', row)">
      <el-table-column label="标题" prop="title" />
      <el-table-column label="来源" prop="sourceType" width="90" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button text type="danger" size="small" @click.stop="emit('remove', row.id)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && documents.length === 0" description="暂无文档" />
  </div>
</template>

<style scoped lang="less">
:deep(.el-table__row) {
  cursor: pointer;
}
</style>
