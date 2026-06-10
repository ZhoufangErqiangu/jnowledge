<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useApiAction } from '@/hooks/useApiAction'
import { useConfirmDelete } from '@/hooks/useConfirmDelete'
import { useCitationNav } from '@/hooks/useCitationNav'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'

const router = useRouter()
const route = useRoute()
const chat = useChatStore()
const { run } = useApiAction()
const { confirmDelete } = useConfirmDelete()
const { gotoCitation } = useCitationNav()

const input = ref('')

// 路由是当前会话的真相源：/chat/<id> ↔ chat.currentId。
onMounted(() =>
  run(async () => {
    await chat.loadConversations()
    const id = route.params.id as string | undefined
    if (id) {
      await chat.open(id)
    } else if (chat.conversations.length > 0) {
      // 裸 /chat 默认落到最近一条会话，保持 URL 与状态一致。
      router.replace(`/chat/${chat.conversations[0]!.id}`)
    }
  }, '加载失败'),
)

watch(
  () => route.params.id,
  (id) => {
    if (id && id !== chat.currentId) chat.open(id as string)
  },
)

function selectConversation(id: string) {
  if (chat.streaming) return
  router.push(`/chat/${id}`)
}

async function createConversation() {
  await chat.create()
  if (chat.currentId) router.push(`/chat/${chat.currentId}`)
}

function removeConversation(id: string) {
  confirmDelete('确认删除该会话？', async () => {
    await chat.remove(id)
    if (route.params.id === id) router.push('/chat')
  })
}

async function send() {
  const q = input.value.trim()
  if (!q || chat.streaming) return
  if (!chat.currentId) {
    await chat.create()
    if (chat.currentId) router.replace(`/chat/${chat.currentId}`)
  }
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
      @create="createConversation"
      @remove="removeConversation"
    />

    <div
      class="flex flex-col h-full rounded-xl border border-white/[0.06] bg-surface/60 overflow-hidden"
    >
      <div class="flex-1 flex flex-col px-4 py-4 overflow-hidden">
        <MessageList
          :messages="chat.messages"
          :streaming="chat.streaming"
          :stream-text="chat.streamText"
          :stream-reasoning="chat.streamReasoning"
          :stream-citations="chat.streamCitations"
          :stream-steps="chat.streamSteps"
          @cite="gotoCitation"
        />
        <ChatComposer
          v-model="input"
          v-model:tier="chat.tier"
          v-model:thinking="chat.thinking"
          :streaming="chat.streaming"
          :conversation-id="chat.currentId"
          @send="send"
        />
      </div>
    </div>
  </div>
</template>
