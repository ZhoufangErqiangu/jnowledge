<script setup lang="ts">
import type { Conversation } from '@jnowledge/shared'
import ConversationListItem from '@/components/chat/ConversationListItem.vue'

// 左侧会话列表：仅负责遍历与空态，单项交互由 ConversationListItem 承担。
defineProps<{
  conversations: Conversation[]
  currentId: string | null
  isGlobal: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  create: []
  remove: [id: string]
}>()
</script>

<template>
  <el-card class="cv-pane" shadow="never">
    <template #header>
      <div class="pane-head">
        <span class="pane-label">{{ isGlobal ? '🌐 全局助手' : '会话' }}</span>
        <el-button text type="primary" @click="emit('create')">+ 新会话</el-button>
      </div>
    </template>
    <ul class="cv-list">
      <ConversationListItem
        v-for="cv in conversations"
        :key="cv.id"
        :conversation="cv"
        :active="cv.id === currentId"
        @select="emit('select', cv.id)"
        @remove="emit('remove', cv.id)"
      />
    </ul>
    <el-empty v-if="conversations.length === 0" description="暂无会话" :image-size="60" />
  </el-card>
</template>

<style scoped lang="less">
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pane-label {
  font-weight: 600;
}
.cv-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
