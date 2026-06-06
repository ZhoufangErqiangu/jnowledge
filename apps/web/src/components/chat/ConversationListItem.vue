<script setup lang="ts">
import type { Conversation } from '@jnowledge/shared'

// 单条会话项：把 v-for 里的标记与交互收口为独立组件，列表只负责遍历。
defineProps<{ conversation: Conversation; active: boolean }>()
const emit = defineEmits<{ select: []; remove: [] }>()
</script>

<template>
  <li :class="{ active }" @click="emit('select')">
    <span class="cv-title">{{ conversation.title }}</span>
    <el-button text size="small" type="danger" @click.stop="emit('remove')">删</el-button>
  </li>
</template>

<style scoped lang="less">
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
li:hover {
  background: var(--el-fill-color-light);
}
li.active {
  background: var(--el-color-primary-light-9);
}
.cv-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
