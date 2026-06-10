<script setup lang="ts">
import type { Conversation } from '@jnowledge/shared'
import { MessageSquare } from 'lucide-vue-next'
import ConversationListItem from '@/components/chat/ConversationListItem.vue'
import Button from '@/components/ui/Button.vue'

defineProps<{
  conversations: Conversation[]
  currentId: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  create: []
  remove: [id: string]
}>()
</script>

<template>
  <div
    class="flex flex-col h-full bg-surface-dark/60 border border-white/[0.06] rounded-xl overflow-hidden"
  >
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.05] shrink-0">
      <span class="font-semibold text-sm text-white/80">🌐 全局助手</span>
      <Button
        variant="ghost"
        size="sm"
        class="text-brand hover:text-brand hover:bg-brand/10 h-7 px-2 text-xs"
        @click="emit('create')"
      >
        + 新会话
      </Button>
    </div>

    <div v-if="conversations.length > 0" class="flex-1 overflow-y-auto p-2">
      <ul class="space-y-0.5">
        <ConversationListItem
          v-for="cv in conversations"
          :key="cv.id"
          :conversation="cv"
          :active="cv.id === currentId"
          @select="emit('select', cv.id)"
          @remove="emit('remove', cv.id)"
        />
      </ul>
    </div>

    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center gap-2 text-white/25 p-4"
    >
      <MessageSquare :size="28" class="opacity-40" />
      <span class="text-xs">暂无会话</span>
    </div>
  </div>
</template>
