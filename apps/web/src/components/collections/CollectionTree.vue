<script setup lang="ts">
import type { CollectionTreeNode } from '@jnowledge/shared'
import { Plus } from 'lucide-vue-next'
import TreeNode from '@/components/ui/TreeNode.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'
import Button from '@/components/ui/Button.vue'

defineProps<{ tree: CollectionTreeNode[]; loading: boolean; selectedId?: string | null }>()
const emit = defineEmits<{
  select: [id: string]
  create: [parentId: string | null]
  remove: [node: CollectionTreeNode]
}>()
</script>

<template>
  <div
    class="flex flex-col h-full bg-surface-dark/60 border border-white/[0.06] rounded-xl overflow-hidden"
  >
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.05] shrink-0">
      <span class="font-semibold text-sm text-white/80">知识库</span>
      <Button
        variant="ghost"
        size="sm"
        class="text-brand hover:text-brand hover:bg-brand/10 h-7 px-2 text-xs"
        @click="emit('create', null)"
      >
        <Plus :size="12" />
        新建
      </Button>
    </div>

    <div v-if="loading" class="p-3 space-y-2">
      <SkeletonBlock class="h-7 w-3/4" />
      <SkeletonBlock class="h-7 w-1/2 ml-3" />
      <SkeletonBlock class="h-7 w-2/3" />
      <SkeletonBlock class="h-7 w-1/3 ml-6" />
    </div>

    <div v-else-if="tree.length === 0" class="flex-1 flex items-center justify-center text-white/25 text-sm">
      暂无知识库
    </div>

    <div v-else class="flex-1 overflow-y-auto p-2">
      <TreeNode
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :level="0"
        :selected-id="selectedId"
        @select="emit('select', $event)"
        @create="emit('create', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
  </div>
</template>
