<script setup lang="ts">
// 底部输入区：文本用 v-model 双向绑定，发送以事件上抛。
// 模式由会话类型决定：全局会话=Agent（跨库自主编排），库内会话=RAG 单轮（无 agent）。
const text = defineModel<string>({ required: true })

defineProps<{ streaming: boolean; isGlobal: boolean }>()
const emit = defineEmits<{ send: [] }>()
</script>

<template>
  <div class="composer">
    <el-input
      v-model="text"
      type="textarea"
      :rows="2"
      resize="none"
      placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
      @keydown.enter.exact.prevent="emit('send')"
    />
    <div class="composer-actions">
      <el-tag size="small" :type="isGlobal ? 'success' : 'info'" effect="plain">
        {{ isGlobal ? 'Agent' : 'RAG' }}
      </el-tag>
      <el-button type="primary" :loading="streaming" @click="emit('send')">发送</el-button>
    </div>
  </div>
</template>

<style scoped lang="less">
.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color);
}
.composer :deep(.el-textarea) {
  flex: 1;
}
.composer-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
</style>
