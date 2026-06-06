<script setup lang="ts">
import type { CollectionTreeNode } from '@jnowledge/shared'

// 知识库树：纯展示，选择/新建子库/删除以事件上抛。
defineProps<{ tree: CollectionTreeNode[]; loading: boolean }>()
const emit = defineEmits<{
  select: [id: string]
  create: [parentId: string | null]
  remove: [node: CollectionTreeNode]
}>()

const treeProps = { label: 'name', children: 'children' }
</script>

<template>
  <el-card class="tree-pane" shadow="never">
    <template #header>
      <div class="pane-head">
        <span>知识库</span>
        <el-button text type="primary" @click="emit('create', null)">+ 新建</el-button>
      </div>
    </template>
    <el-tree
      v-loading="loading"
      :data="tree"
      :props="treeProps"
      node-key="id"
      highlight-current
      @node-click="(node: CollectionTreeNode) => emit('select', node.id)"
    >
      <template #default="{ data }">
        <span class="tree-node">
          <span>{{ data.name }}</span>
          <span class="tree-actions">
            <el-button text size="small" @click.stop="emit('create', data.id)">子库</el-button>
            <el-button text size="small" type="danger" @click.stop="emit('remove', data)">
              删
            </el-button>
          </span>
        </span>
      </template>
    </el-tree>
    <el-empty v-if="!loading && tree.length === 0" description="暂无知识库" />
  </el-card>
</template>

<style scoped lang="less">
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tree-node {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}
.tree-actions {
  opacity: 0.6;
}
</style>
