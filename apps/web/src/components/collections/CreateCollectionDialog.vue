<script setup lang="ts">
import { ref, watch } from 'vue'

// 新建知识库对话框：自管表单态，提交以事件上抛；可见性由父级 v-model 控制（成功后由父级关闭）。
const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ parentId: string | null }>()
const emit = defineEmits<{ submit: [name: string] }>()

const name = ref('')
// 每次打开重置输入
watch(visible, (v) => {
  if (v) name.value = ''
})

function submit() {
  const n = name.value.trim()
  if (!n) return
  emit('submit', n)
}
</script>

<template>
  <el-dialog v-model="visible" title="新建知识库" width="420">
    <el-form label-position="top">
      <el-form-item label="名称">
        <el-input v-model="name" placeholder="知识库名称" @keyup.enter="submit" />
      </el-form-item>
      <p v-if="props.parentId" class="page-muted">将创建为所选库的子库</p>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="submit">创建</el-button>
    </template>
  </el-dialog>
</template>
