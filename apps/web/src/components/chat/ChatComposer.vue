<script setup lang="ts">
// 底部输入区：文本与 Agent/RAG 开关用 v-model 双向绑定，发送以事件上抛。
const text = defineModel<string>({ required: true })
const agentMode = defineModel<boolean>('agentMode', { required: true })

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
      <el-tag v-if="isGlobal" size="small" type="success" effect="plain">Agent</el-tag>
      <el-switch
        v-else
        v-model="agentMode"
        :disabled="streaming"
        inline-prompt
        active-text="Agent"
        inactive-text="RAG"
        title="Agent 模式：自主编排检索，展示执行轨迹"
      />
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
