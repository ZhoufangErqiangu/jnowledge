<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'

const title = defineModel<string>('title', { required: true })
const content = defineModel<string>('content', { required: true })
defineProps<{ saving: boolean }>()
const emit = defineEmits<{ save: [] }>()
</script>

<template>
  <div class="space-y-4">
    <div>
      <label class="text-sm text-white/60 mb-1.5 block">标题</label>
      <Input v-model="title" class="text-base font-medium" />
    </div>
    <div>
      <label class="text-sm text-white/60 mb-1.5 block">正文（Markdown）</label>
      <Textarea
        v-model="content"
        :rows="18"
        class="font-mono text-sm"
        resize="none"
      />
    </div>
    <Button variant="gradient" :loading="saving" @click="emit('save')">
      保存（生成新版本）
    </Button>
  </div>
</template>
