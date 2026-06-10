<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import DialogContent from '@/components/ui/DialogContent.vue'
import DialogHeader from '@/components/ui/DialogHeader.vue'
import DialogTitle from '@/components/ui/DialogTitle.vue'
import DialogFooter from '@/components/ui/DialogFooter.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const visible = defineModel<boolean>({ required: true })
const props = defineProps<{ parentId: string | null }>()
const emit = defineEmits<{ submit: [name: string] }>()

const name = ref('')
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
  <Dialog v-model:open="visible">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle>新建知识库</DialogTitle>
      </DialogHeader>
      <div class="py-1 space-y-3">
        <div>
          <label class="text-sm text-white/60 mb-1.5 block">名称</label>
          <Input v-model="name" placeholder="知识库名称" @keyup.enter="submit" />
        </div>
        <p v-if="props.parentId" class="text-xs text-white/40">将创建为所选库的子库</p>
      </div>
      <DialogFooter>
        <Button variant="ghost" @click="visible = false">取消</Button>
        <Button @click="submit">创建</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
