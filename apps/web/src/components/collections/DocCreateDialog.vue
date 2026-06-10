<script setup lang="ts">
import { reactive, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import DialogContent from '@/components/ui/DialogContent.vue'
import DialogHeader from '@/components/ui/DialogHeader.vue'
import DialogTitle from '@/components/ui/DialogTitle.vue'
import DialogFooter from '@/components/ui/DialogFooter.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ submit: [payload: { title: string; content: string }] }>()

const form = reactive({ title: '', content: '' })
watch(visible, (v) => {
  if (v) { form.title = ''; form.content = '' }
})

function submit() {
  const title = form.title.trim()
  if (!title) return
  emit('submit', { title, content: form.content })
}
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="max-w-[640px]">
      <DialogHeader>
        <DialogTitle>新建文档</DialogTitle>
      </DialogHeader>
      <div class="py-1 space-y-3">
        <div>
          <label class="text-sm text-white/60 mb-1.5 block">标题</label>
          <Input v-model="form.title" placeholder="文档标题" />
        </div>
        <div>
          <label class="text-sm text-white/60 mb-1.5 block">正文（Markdown）</label>
          <Textarea v-model="form.content" :rows="12" placeholder="# 标题…" resize="none" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" @click="visible = false">取消</Button>
        <Button @click="submit">创建</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
