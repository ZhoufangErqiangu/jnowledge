<script setup lang="ts">
import { ref } from 'vue'
import type { CollectionTreeNode } from '@jnowledge/shared'
import { ChevronRight, BookOpen, Plus, Trash2 } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

defineProps<{ node: CollectionTreeNode; level: number; selectedId?: string | null | undefined }>()
const emit = defineEmits<{
  select: [id: string]
  create: [parentId: string]
  remove: [node: CollectionTreeNode]
}>()

const expanded = ref(true)
</script>

<template>
  <div>
    <div
      :style="{ paddingLeft: `${level * 12}px` }"
      :class="
        cn(
          'group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer',
          'text-sm transition-all duration-100',
          selectedId === node.id
            ? 'bg-brand/20 text-white'
            : 'text-white/70 hover:bg-white/[0.05] hover:text-white',
        )
      "
      @click="emit('select', node.id)"
    >
      <ChevronRight
        :size="12"
        :class="
          cn(
            'text-white/30 transition-transform duration-150 shrink-0',
            expanded && node.children?.length ? 'rotate-90' : '',
          )
        "
        @click.stop="expanded = !expanded"
      />
      <BookOpen :size="13" class="text-brand/60 shrink-0" />
      <span class="truncate flex-1">{{ node.name }}</span>
      <span class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
        <button
          class="p-0.5 rounded hover:bg-brand/20 hover:text-brand text-white/40 transition-colors"
          @click.stop="emit('create', node.id)"
        >
          <Plus :size="11" />
        </button>
        <button
          class="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 text-white/40 transition-colors"
          @click.stop="emit('remove', node)"
        >
          <Trash2 :size="11" />
        </button>
      </span>
    </div>

    <div v-if="expanded && node.children?.length">
      <TreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        @select="emit('select', $event)"
        @create="emit('create', $event)"
        @remove="emit('remove', $event)"
      />
    </div>
  </div>
</template>
