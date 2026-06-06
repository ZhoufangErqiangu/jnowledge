<script setup lang="ts">
import { reactive, watch } from 'vue'

// 新建文档对话框：自管标题/正文，提交以事件上抛；可见性由父级 v-model 控制。
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ submit: [payload: { title: string; content: string }] }>()

const form = reactive({ title: '', content: '' })
watch(visible, (v) => {
  if (v) {
    form.title = ''
    form.content = ''
  }
})

function submit() {
  const title = form.title.trim()
  if (!title) return
  emit('submit', { title, content: form.content })
}
</script>

<template>
  <el-dialog v-model="visible" title="新建文档" width="640">
    <el-form label-position="top">
      <el-form-item label="标题">
        <el-input v-model="form.title" placeholder="文档标题" />
      </el-form-item>
      <el-form-item label="正文（Markdown）">
        <el-input v-model="form.content" type="textarea" :rows="12" placeholder="# 标题…" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>
