<script setup lang="ts">
// 折叠的「思考过程」面板：流式草稿与已落库消息共用。空白内容不渲染。
defineProps<{ reasoning: string }>()
</script>

<template>
  <el-collapse v-if="reasoning.trim()" class="reasoning">
    <el-collapse-item title="思考过程">
      <pre class="reasoning-body">{{ reasoning }}</pre>
    </el-collapse-item>
  </el-collapse>
</template>

<style scoped lang="less">
.reasoning {
  margin-bottom: 8px;
}
.reasoning-body {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
