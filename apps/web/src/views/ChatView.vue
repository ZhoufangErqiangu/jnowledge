<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useApiAction } from '@/hooks/useApiAction'
import { useConfirmDelete } from '@/hooks/useConfirmDelete'
import { useCitationNav } from '@/hooks/useCitationNav'
import ConversationList from '@/components/chat/ConversationList.vue'
import MessageList from '@/components/chat/MessageList.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'

const route = useRoute()
const chat = useChatStore()
const { run } = useApiAction()
const { confirmDelete } = useConfirmDelete()
const { gotoCitation } = useCitationNav()

// 无 collectionId 参数 → 全局助手（仅 agent，跨库检索）。
const collectionId = (route.params.collectionId as string | undefined) ?? null

const input = ref('')

onMounted(() =>
  run(async () => {
    await chat.loadConversations(collectionId)
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
  <div class="chat">
    <ConversationList
      :conversations="chat.conversations"
      :current-id="chat.currentId"
      :is-global="chat.isGlobal"
      @select="selectConversation"
      @create="chat.create()"
      @remove="removeConversation"
    />

    <el-card class="msg-pane" shadow="never">
      <div v-if="chat.currentId" class="pane-toolbar">
        <router-link
          :to="{ name: 'context-debug', params: { id: chat.currentId } }"
          class="debug-link"
        >
          调试上下文
        </router-link>
      </div>
      <MessageList
        :messages="chat.messages"
        :streaming="chat.streaming"
        :stream-text="chat.streamText"
        :stream-reasoning="chat.streamReasoning"
        :stream-citations="chat.streamCitations"
        :stream-steps="chat.streamSteps"
        :is-global="chat.isGlobal"
        @cite="gotoCitation"
      />
      <ChatComposer
        v-model="input"
        v-model:agent-mode="chat.agentMode"
        :streaming="chat.streaming"
        :is-global="chat.isGlobal"
        @send="send"
      />
    </el-card>
  </div>
</template>

<style scoped lang="less">
.chat {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  height: 100%;
}
.msg-pane {
  display: flex;
  flex-direction: column;
}
.msg-pane :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.pane-toolbar {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 8px;
}
.debug-link {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-decoration: none;
}
.debug-link:hover {
  color: var(--el-color-primary);
}
</style>
