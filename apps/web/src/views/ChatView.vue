<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useApiAction } from '@/hooks/useApiAction'
import { useConfirmDelete } from '@/hooks/useConfirmDelete'
import { useCitationNav } from '@/hooks/useCitationNav'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'

const chat = useChatStore()
const { run } = useApiAction()
const { confirmDelete } = useConfirmDelete()
const { gotoCitation } = useCitationNav()

const input = ref('')

onMounted(() =>
  run(async () => {
    await chat.loadConversations()
    if (chat.conversations.length > 0) await chat.open(chat.conversations[0]!.id)
  }, '加载失败'),
)

async function selectConversation(id: string) {
  if (chat.streaming) return
  await chat.open(id)
}

function removeConversation(id: string) {
  confirmDelete('确认删除该会话？', () => chat.remove(id))
}

async function send() {
  const q = input.value.trim()
  if (!q || chat.streaming) return
  if (!chat.currentId) await chat.create()
  input.value = ''
  await chat.ask(q)
}
</script>

<template>
  <div class="grid h-full gap-4" style="grid-template-columns: 260px 1fr">
    <ConversationList
      :conversations="chat.conversations"
      :current-id="chat.currentId"
      @select="selectConversation"
      @create="chat.create()"
      @remove="removeConversation"
    />

    <div
      class="flex flex-col h-full rounded-xl border border-white/[0.06] bg-surface/60 overflow-hidden"
    >
      <div v-if="chat.currentId" class="flex justify-end px-4 py-2 border-b border-white/[0.05] shrink-0">
        <router-link
          :to="{ name: 'context-debug', params: { id: chat.currentId } }"
          class="text-xs text-white/30 hover:text-white/50 transition-colors"
        >
          调试上下文
        </router-link>
      </div>
      <div class="flex-1 flex flex-col px-4 pb-4 overflow-hidden">
        <MessageList
          :messages="chat.messages"
          :streaming="chat.streaming"
          :stream-text="chat.streamText"
          :stream-reasoning="chat.streamReasoning"
          :stream-citations="chat.streamCitations"
          :stream-steps="chat.streamSteps"
          @cite="gotoCitation"
        />
        <ChatComposer v-model="input" :streaming="chat.streaming" @send="send" />
      </div>
    </div>
  </div>
</template>
