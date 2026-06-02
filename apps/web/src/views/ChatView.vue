<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Citation } from '@jnowledge/shared'
import { useChatStore } from '@/stores/chat'
import { ApiError } from '@/apis/http'
import { formatDate } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
const collectionId = route.params.collectionId as string

const input = ref('')
const scroller = ref<HTMLElement | null>(null)

async function init() {
  try {
    await chat.loadConversations(collectionId)
    if (chat.conversations.length > 0) await chat.open(chat.conversations[0]!.id)
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败')
  }
}
onMounted(init)

function scrollToBottom() {
  nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
// 消息或流式内容变化时滚到底。
watch(() => [chat.messages.length, chat.streamText, chat.streamReasoning], scrollToBottom, {
  deep: true,
})

async function selectConversation(id: string) {
  if (chat.streaming) return
  await chat.open(id)
  scrollToBottom()
}

async function newConversation() {
  await chat.create()
}

async function removeConversation(id: string) {
  await ElMessageBox.confirm('确认删除该会话？', '提示', { type: 'warning' })
  await chat.remove(id)
}

async function send() {
  const q = input.value.trim()
  if (!q || chat.streaming) return
  if (!chat.currentId) await chat.create()
  input.value = ''
  await chat.ask(q)
}

// 引用跳转：到文档详情，带版本与高亮区间。
function gotoCitation(c: Citation) {
  router.push({
    name: 'document',
    params: { id: c.documentId },
    query: { version: c.versionId, hl: `${c.charStart}-${c.charEnd}` },
  })
}
</script>

<template>
  <div class="chat">
    <!-- 左：会话列表 -->
    <el-card class="cv-pane" shadow="never">
      <template #header>
        <div class="pane-head">
          <el-button text @click="router.push('/collections')">← 知识库</el-button>
          <el-button text type="primary" @click="newConversation">+ 新会话</el-button>
        </div>
      </template>
      <ul class="cv-list">
        <li
          v-for="cv in chat.conversations"
          :key="cv.id"
          :class="{ active: cv.id === chat.currentId }"
          @click="selectConversation(cv.id)"
        >
          <span class="cv-title">{{ cv.title }}</span>
          <el-button text size="small" type="danger" @click.stop="removeConversation(cv.id)">删</el-button>
        </li>
      </ul>
      <el-empty v-if="chat.conversations.length === 0" description="暂无会话" :image-size="60" />
    </el-card>

    <!-- 右：消息流 -->
    <el-card class="msg-pane" shadow="never">
      <div ref="scroller" class="msg-scroll">
        <div v-for="m in chat.messages" :key="m.id" class="msg" :class="m.role">
          <div class="bubble">
            <div class="content">{{ m.content }}</div>
            <div v-if="m.citations.length" class="cites">
              <el-tag
                v-for="c in m.citations"
                :key="c.marker"
                size="small"
                class="cite"
                @click="gotoCitation(c)"
              >
                [{{ c.marker }}] {{ c.documentTitle }}
              </el-tag>
            </div>
            <div class="ts page-muted">{{ formatDate(m.createdAt) }}</div>
          </div>
        </div>

        <!-- 流式草稿气泡 -->
        <div v-if="chat.streaming" class="msg assistant">
          <div class="bubble">
            <el-collapse v-if="chat.streamReasoning" class="reasoning">
              <el-collapse-item title="思考过程">
                <pre class="reasoning-body">{{ chat.streamReasoning }}</pre>
              </el-collapse-item>
            </el-collapse>
            <div class="content">{{ chat.streamText }}<span class="caret">▍</span></div>
            <div v-if="chat.streamCitations.length" class="cites">
              <el-tag
                v-for="c in chat.streamCitations"
                :key="c.marker"
                size="small"
                class="cite"
                @click="gotoCitation(c)"
              >
                [{{ c.marker }}] {{ c.documentTitle }}
              </el-tag>
            </div>
          </div>
        </div>

        <el-empty
          v-if="chat.messages.length === 0 && !chat.streaming"
          description="向该知识库提问，答案将基于库内文档并标注引用"
        />
      </div>

      <div class="composer">
        <el-input
          v-model="input"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
          @keydown.enter.exact.prevent="send"
        />
        <el-button type="primary" :loading="chat.streaming" @click="send">发送</el-button>
      </div>
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
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cv-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cv-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.cv-list li:hover {
  background: var(--el-fill-color-light);
}
.cv-list li.active {
  background: var(--el-color-primary-light-9);
}
.cv-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.msg-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 6px;
}
.msg {
  display: flex;
  margin-bottom: 14px;
}
.msg.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.msg.user .bubble {
  background: var(--el-color-primary-light-9);
}
.content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.cites {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cite {
  cursor: pointer;
}
.reasoning {
  margin-bottom: 8px;
}
.reasoning-body {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ts {
  font-size: 11px;
  margin-top: 6px;
}
.caret {
  animation: blink 1s step-start infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color);
}
.composer :deep(.el-textarea) {
  flex: 1;
}
</style>
