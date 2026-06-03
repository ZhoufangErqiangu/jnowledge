<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Citation } from '@jnowledge/shared'
import { useChatStore } from '@/stores/chat'
import { ApiError } from '@/apis/http'
import { formatDate } from '@/utils/format'
import { renderMarkdown } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()
// 无 collectionId 参数 → 全局助手（仅 agent，跨库检索）。
const collectionId = (route.params.collectionId as string | undefined) ?? null

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
watch(
  () => [chat.messages.length, chat.streamText, chat.streamReasoning, chat.streamSteps.length],
  scrollToBottom,
  { deep: true },
)

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
          <span class="pane-label">{{ chat.isGlobal ? '🌐 全局助手' : '会话' }}</span>
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
          <el-button text size="small" type="danger" @click.stop="removeConversation(cv.id)"
            >删</el-button
          >
        </li>
      </ul>
      <el-empty v-if="chat.conversations.length === 0" description="暂无会话" :image-size="60" />
    </el-card>

    <!-- 右：消息流 -->
    <el-card class="msg-pane" shadow="never">
      <div ref="scroller" class="msg-scroll">
        <div v-for="m in chat.messages" :key="m.id" class="msg" :class="m.role">
          <div class="bubble">
            <!-- 用户消息纯文本；助手消息按 Markdown 渲染 -->
            <div
              v-if="m.role === 'assistant'"
              class="content md"
              v-html="renderMarkdown(m.content)"
            />
            <div v-else class="content">{{ m.content }}</div>
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
            <!-- Agent 执行轨迹（仅 Agent 模式、流式期间展示） -->
            <el-collapse v-if="chat.streamSteps.length" class="trace" :model-value="['t']">
              <el-collapse-item name="t" :title="`执行轨迹（${chat.streamSteps.length} 步）`">
                <div v-for="s in chat.streamSteps" :key="s.seq" class="trace-step">
                  <el-tag size="small" :type="s.running ? 'info' : s.ok ? 'success' : 'danger'">
                    {{ s.kind }}:{{ s.name }}
                  </el-tag>
                  <span class="trace-summary">{{ s.running ? '执行中…' : s.summary }}</span>
                </div>
              </el-collapse-item>
            </el-collapse>
            <el-collapse v-if="chat.streamReasoning" class="reasoning">
              <el-collapse-item title="思考过程">
                <pre class="reasoning-body">{{ chat.streamReasoning }}</pre>
              </el-collapse-item>
            </el-collapse>
            <div class="content md">
              <span v-html="renderMarkdown(chat.streamText)" /><span class="caret">▍</span>
            </div>
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
          :description="
            chat.isGlobal
              ? '全局助手：自动选择相关知识库检索作答，并标注引用'
              : '向该知识库提问，答案将基于库内文档并标注引用'
          "
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
        <div class="composer-actions">
          <el-tag v-if="chat.isGlobal" size="small" type="success" effect="plain">Agent</el-tag>
          <el-switch
            v-else
            v-model="chat.agentMode"
            :disabled="chat.streaming"
            inline-prompt
            active-text="Agent"
            inactive-text="RAG"
            title="Agent 模式：自主编排检索，展示执行轨迹"
          />
          <el-button type="primary" :loading="chat.streaming" @click="send">发送</el-button>
        </div>
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
.pane-label {
  font-weight: 600;
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
/* Markdown 渲染块：交给元素自身排版，去掉 pre-wrap 以免标签间多余空白 */
.content.md {
  white-space: normal;
}
.content.md :deep(p) {
  margin: 0 0 8px;
}
.content.md :deep(p:last-child) {
  margin-bottom: 0;
}
.content.md :deep(h1),
.content.md :deep(h2),
.content.md :deep(h3),
.content.md :deep(h4) {
  margin: 12px 0 8px;
  font-size: 1.05em;
  font-weight: 600;
}
.content.md :deep(ul),
.content.md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}
.content.md :deep(li) {
  margin: 2px 0;
}
.content.md :deep(code) {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 0.92em;
  background: var(--el-fill-color-dark);
  padding: 1px 5px;
  border-radius: 4px;
}
.content.md :deep(pre) {
  background: var(--el-fill-color-darker);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}
.content.md :deep(pre code) {
  background: none;
  padding: 0;
}
.content.md :deep(blockquote) {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
}
.content.md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 0.95em;
}
.content.md :deep(th),
.content.md :deep(td) {
  border: 1px solid var(--el-border-color);
  padding: 5px 10px;
  text-align: left;
}
.content.md :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}
.content.md :deep(a) {
  color: var(--el-color-primary);
}
.content.md :deep(img) {
  max-width: 100%;
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
.trace {
  margin-bottom: 8px;
}
.trace-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.trace-summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.composer-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
</style>
