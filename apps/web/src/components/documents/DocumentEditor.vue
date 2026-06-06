<script setup lang="ts">
// 文档编辑表单：标题/正文双向绑定，保存以事件上抛（saving 由父级控制）。
const title = defineModel<string>('title', { required: true })
const content = defineModel<string>('content', { required: true })

defineProps<{ saving: boolean }>()
const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <el-form label-position="top">
    <el-form-item label="标题">
      <el-input v-model="title" />
    </el-form-item>
    <el-form-item label="正文（Markdown）">
      <el-input v-model="content" type="textarea" :rows="18" />
    </el-form-item>
    <el-button type="primary" :loading="saving" @click="emit('save')">保存（生成新版本）</el-button>
  </el-form>
</template>
