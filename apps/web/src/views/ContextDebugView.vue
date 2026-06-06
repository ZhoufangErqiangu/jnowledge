<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ContextDebug, ContextItemDebug } from '@jnowledge/shared'
import { chatApi } from '@/apis/chat'
import { useApiAction } from '@/hooks/useApiAction'

const route = useRoute()
const router = useRouter()
const { run } = useApiAction()

const conversationId = route.params.id as string
const data = ref<ContextDebug | null>(null)

onMounted(() =>
  run(async () => {
    data.value = await chatApi.contextDebug(conversationId)
  }, '加载调试上下文失败'),
)

const raw = computed(() => data.value?.raw ?? [])
const llmView = computed(() => data.value?.llmView ?? [])
const userView = computed(() => data.value?.userView ?? [])

const KIND_TAG: Record<ContextItemDebug['kind'], 'primary' | 'success' | 'warning'> = {
  user: 'primary',
  assistant: 'success',
  tool_result: 'warning',
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

function hasMeta(meta: Record<string, unknown>): boolean {
  return Object.keys(meta).length > 0
}

function back() {
  router.back()
}
</script>

<template>
  <div class="ctx-debug">
    <header class="head">
      <el-button text @click="back">← 返回</el-button>
      <div v-if="data" class="title">
        <span class="name">{{ data.conversation.title }}</span>
        <el-tag size="small" type="info" effect="plain">
          {{ data.conversation.collectionId ? '知识库会话' : '全局会话' }}
        </el-tag>
        <code class="cid">{{ conversationId }}</code>
      </div>
    </header>

    <p class="hint">
      同一份<strong>原始上下文</strong>（context_items 全量事件日志）派生出
      <strong>推理视图</strong>（喂给 LLM）与<strong>用户视图</strong>（前端可见聊天）。
    </p>

    <el-tabs class="tabs">
      <!-- 原始上下文：未经投影过滤的全量条目 -->
      <el-tab-pane :label="`原始上下文 (${raw.length})`">
        <div v-if="!raw.length" class="empty">暂无上下文条目。</div>
        <ol class="raw-list">
          <li v-for="(it, i) in raw" :key="it.id" class="raw-item">
            <div class="row-head">
              <span class="seq">#{{ i + 1 }}</span>
              <el-tag size="small" :type="KIND_TAG[it.kind]">{{ it.kind }}</el-tag>
              <el-tag
                size="small"
                effect="plain"
                :type="it.flags.state === 'active' ? 'success' : 'info'"
              >
                {{ it.flags.state }}
              </el-tag>
              <el-tag v-if="it.runId" size="small" effect="plain" type="info">run</el-tag>
              <span class="ts">{{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>

            <pre class="content">{{ it.content || '（空文本——多为纯工具调用轮）' }}</pre>

            <div v-if="it.citations.length" class="block">
              <span class="block-label">citations ({{ it.citations.length }})</span>
              <pre class="json">{{ pretty(it.citations) }}</pre>
            </div>

            <el-collapse v-if="hasMeta(it.meta)" class="meta-collapse">
              <el-collapse-item :title="`meta（工具调用 / 执行轨迹）`">
                <pre class="json">{{ pretty(it.meta) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </li>
        </ol>
      </el-tab-pane>

      <!-- 推理视图：投影引擎派生的跨轮历史 -->
      <el-tab-pane :label="`推理视图 (${llmView.length})`">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="此为投影引擎从原始上下文派生的跨轮历史"
          description="system 提示与当轮检索到的「资料」块在请求时临时注入，不持久化于原始上下文，故不在此列。"
        />
        <div class="view-msgs">
          <div v-for="(m, i) in llmView" :key="i" class="view-msg" :class="m.role">
            <el-tag size="small" effect="plain">{{ m.role }}</el-tag>
            <pre class="content">{{ m.content }}</pre>
          </div>
        </div>
      </el-tab-pane>

      <!-- 用户视图：前端可见聊天记录 -->
      <el-tab-pane :label="`用户视图 (${userView.length})`">
        <div class="view-msgs">
          <div v-for="m in userView" :key="m.id" class="view-msg" :class="m.role">
            <el-tag size="small" effect="plain">{{ m.role }}</el-tag>
            <pre class="content">{{ m.content }}</pre>
            <div v-if="m.citations.length" class="block">
              <span class="block-label">citations ({{ m.citations.length }})</span>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped lang="less">
.ctx-debug {
  height: 100%;
  overflow: auto;
  padding: 4px 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-weight: 600;
}
.cid {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.hint {
  margin: 8px 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.empty {
  color: var(--el-text-color-secondary);
  padding: 16px 0;
}
.raw-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.raw-item {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 10px 12px;
}
.row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.seq {
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
.ts {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--el-font-family);
  font-size: 13px;
  line-height: 1.5;
}
.block {
  margin-top: 8px;
}
.block-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}
.json {
  margin: 4px 0 0;
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.meta-collapse {
  margin-top: 8px;
}
.view-msgs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.view-msg {
  border-left: 3px solid var(--el-border-color);
  padding: 4px 0 4px 10px;
}
.view-msg.user {
  border-left-color: var(--el-color-primary);
}
.view-msg.assistant {
  border-left-color: var(--el-color-success);
}
.view-msg.system {
  border-left-color: var(--el-color-info);
}
</style>
