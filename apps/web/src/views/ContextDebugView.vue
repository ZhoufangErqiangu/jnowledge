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
const runs = computed(() => data.value?.runs ?? [])
const systemView = computed(() => data.value?.systemView ?? [])
const llmView = computed(() => data.value?.llmView ?? [])
const userView = computed(() => data.value?.userView ?? [])

const KIND_TAG: Record<ContextItemDebug['kind'], 'primary' | 'success' | 'warning'> = {
  user: 'primary',
  assistant: 'success',
  tool_result: 'warning',
}

// 三态色：active=进视图（绿）；hidden=人工降级（灰）；internal=系统子推理留痕（橙）。
const STATE_TAG: Record<string, 'success' | 'info' | 'warning'> = {
  active: 'success',
  hidden: 'info',
  internal: 'warning',
}

/** run id → 节点（含 parentRunId / agentName），用于重建嵌套调用树。 */
const runById = computed(() => new Map(runs.value.map((r) => [r.id, r])))

/** run 在树中的深度（顶层=0），沿 parentRunId 链上溯计数（带环保护）。 */
function runDepth(runId: string | null): number {
  let depth = 0
  let cur = runId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const node = runById.value.get(cur)
    if (!node || !node.parentRunId) break
    depth += 1
    cur = node.parentRunId
  }
  return depth
}

/** 一条 raw 条目的缩进深度（按其所属 run 在树中的层级；无 run 的 RAG 单轮路径为 0）。 */
function itemDepth(it: ContextItemDebug): number {
  return it.runId ? runDepth(it.runId) : 0
}

function agentNameOf(runId: string | null): string | undefined {
  return runId ? runById.value.get(runId)?.agentName : undefined
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

function hasMeta(meta: Record<string, unknown>): boolean {
  return Object.keys(meta).length > 0
}

/** 一条 assistant 对应那次 LLM 调用的耗时 + token 用量（meta.llm，由 runtime 实测落库）。 */
interface LlmStat {
  durationMs: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedPromptTokens?: number }
}
function llmStat(it: ContextItemDebug): LlmStat | null {
  const llm = it.meta.llm as LlmStat | undefined
  return llm && typeof llm.durationMs === 'number' ? llm : null
}

/** 耗时人读化：≥1s 显示秒（一位小数），否则毫秒。 */
function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function fmtTokens(n: number): string {
  return n.toLocaleString()
}

// 非主线推理（internal 状态条目）：裁决 / 过滤 / system 快照 / 子 agent——留痕但不进任一视图。
const STAGE_LABEL: Record<string, string> = {
  safety: '安全裁决',
  rag_filter: 'RAG 过滤',
  system: 'system 快照',
}

/** internal 条目（按 raw 全序）。stage 标注类别；无 stage 的 internal 多为子 agent 轮。 */
const internalItems = computed(() => raw.value.filter((it) => it.flags.state === 'internal'))

function stageOf(it: ContextItemDebug): string {
  const stage = it.meta.stage
  if (typeof stage === 'string' && STAGE_LABEL[stage]) return STAGE_LABEL[stage]
  return '子推理'
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
      <strong>推理视图</strong>（喂给 LLM）与<strong>用户视图</strong>（前端可见聊天）；
      <strong>非主线推理</strong>单列裁决 / 过滤 / 快照等 internal 留痕（不进任一视图）。
    </p>

    <el-tabs class="tabs">
      <!-- 原始上下文：未经投影过滤的全量条目 -->
      <el-tab-pane :label="`原始上下文 (${raw.length})`">
        <div v-if="!raw.length" class="empty">暂无上下文条目。</div>
        <ol class="raw-list">
          <li
            v-for="(it, i) in raw"
            :key="it.id"
            class="raw-item"
            :class="{ nested: itemDepth(it) > 0 }"
            :style="{ marginLeft: `${itemDepth(it) * 20}px` }"
          >
            <div class="row-head">
              <span class="seq">#{{ i + 1 }}</span>
              <el-tag size="small" :type="KIND_TAG[it.kind]">{{ it.kind }}</el-tag>
              <el-tag size="small" effect="plain" :type="STATE_TAG[it.flags.state] ?? 'info'">
                {{ it.flags.state }}
              </el-tag>
              <el-tag v-if="it.meta.stage" size="small" effect="dark" type="warning">
                {{ it.meta.stage }}
              </el-tag>
              <el-tag v-if="agentNameOf(it.runId)" size="small" effect="plain" type="info">
                {{ agentNameOf(it.runId) }}
              </el-tag>
              <span v-if="llmStat(it)" class="llm-stat">
                <span class="llm-pill" title="本轮 LLM 推理 wall-clock 耗时">
                  ⏱ {{ fmtDuration(llmStat(it)!.durationMs) }}
                </span>
                <span
                  v-if="llmStat(it)!.usage"
                  class="llm-pill"
                  title="token 用量：输入(prompt) / 输出(completion) / 合计"
                >
                  🔢 {{ fmtTokens(llmStat(it)!.usage!.totalTokens) }} tok
                  (↑{{ fmtTokens(llmStat(it)!.usage!.promptTokens) }}
                  ↓{{ fmtTokens(llmStat(it)!.usage!.completionTokens) }})
                </span>
                <span
                  v-if="llmStat(it)!.usage?.cachedPromptTokens"
                  class="llm-pill cache-pill"
                  title="prompt cache 命中：输入 token 中命中缓存的部分（命中部分计费更低）"
                >
                  💾 命中 {{ fmtTokens(llmStat(it)!.usage!.cachedPromptTokens!) }} tok
                  ({{ Math.round((llmStat(it)!.usage!.cachedPromptTokens! / llmStat(it)!.usage!.promptTokens) * 100) }}%)
                </span>
              </span>
              <span class="ts">{{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>

            <pre class="content">{{ it.content || '（空文本——多为纯工具调用轮）' }}</pre>

            <div v-if="it.citations.length" class="block">
              <span class="block-label">citations ({{ it.citations.length }})</span>
              <pre class="json">{{ pretty(it.citations) }}</pre>
            </div>

            <el-collapse v-if="hasMeta(it.meta)" class="meta-collapse">
              <el-collapse-item :title="`meta（工具调用 / 执行轨迹 / 思考过程）`">
                <pre class="json">{{ pretty(it.meta) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </li>
        </ol>
      </el-tab-pane>

      <!-- 非主线推理：internal 状态条目（裁决 / 过滤 / system 快照 / 子 agent），留痕但不进任一视图 -->
      <el-tab-pane :label="`非主线推理 (${internalItems.length})`">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="非主线推理：安全裁决 / RAG 过滤 / system 快照 / 子 agent"
          description="这些是 internal 状态条目——留痕于原始上下文供审计，但被各视图按需排除（不进 LLM 推理，也不进用户聊天）。"
        />
        <div v-if="!internalItems.length" class="empty">暂无非主线推理条目。</div>
        <ol class="raw-list">
          <li v-for="it in internalItems" :key="it.id" class="raw-item nested">
            <div class="row-head">
              <el-tag size="small" effect="dark" type="warning">{{ stageOf(it) }}</el-tag>
              <el-tag v-if="agentNameOf(it.runId)" size="small" effect="plain" type="info">
                {{ agentNameOf(it.runId) }}
              </el-tag>
              <span v-if="llmStat(it)" class="llm-stat">
                <span class="llm-pill" title="本次子推理 LLM 调用 wall-clock 耗时">
                  ⏱ {{ fmtDuration(llmStat(it)!.durationMs) }}
                </span>
                <span
                  v-if="llmStat(it)!.usage"
                  class="llm-pill"
                  title="token 用量：输入(prompt) / 输出(completion) / 合计"
                >
                  🔢 {{ fmtTokens(llmStat(it)!.usage!.totalTokens) }} tok
                  (↑{{ fmtTokens(llmStat(it)!.usage!.promptTokens) }}
                  ↓{{ fmtTokens(llmStat(it)!.usage!.completionTokens) }})
                </span>
                <span
                  v-if="llmStat(it)!.usage?.cachedPromptTokens"
                  class="llm-pill cache-pill"
                  title="prompt cache 命中：输入 token 中命中缓存的部分（命中部分计费更低）"
                >
                  💾 命中 {{ fmtTokens(llmStat(it)!.usage!.cachedPromptTokens!) }} tok
                  ({{ Math.round((llmStat(it)!.usage!.cachedPromptTokens! / llmStat(it)!.usage!.promptTokens) * 100) }}%)
                </span>
              </span>
              <span class="ts">{{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>

            <pre class="content">{{ it.content || '（空文本）' }}</pre>

            <div v-if="it.meta.verdict" class="block">
              <span class="block-label">裁决 / 明细 (verdict)</span>
              <pre class="json">{{ pretty(it.meta.verdict) }}</pre>
            </div>

            <el-collapse v-if="hasMeta(it.meta)" class="meta-collapse">
              <el-collapse-item title="meta（完整）">
                <pre class="json">{{ pretty(it.meta) }}</pre>
              </el-collapse-item>
            </el-collapse>
          </li>
        </ol>
      </el-tab-pane>

      <!-- 推理视图：投影引擎派生的跨轮历史 + 实际发送的 system prompt 快照 -->
      <el-tab-pane :label="`推理视图 (${llmView.length})`">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="此为投影引擎从原始上下文派生的跨轮历史"
          description="system 实际发送值随轮快照落库，下方直接读快照（忠实于发送当时，不重算、抗版本漂移）。当轮检索「资料」块仍于请求时注入，不在此列。"
        />

        <!-- 实际发送的 system prompt（按路径 / run 读快照）。 -->
        <div v-if="systemView.length" class="sys-rebuild">
          <span class="block-label">system prompt 快照</span>
          <el-collapse class="meta-collapse">
            <el-collapse-item v-for="(s, i) in systemView" :key="i" :title="s.label">
              <pre class="content">{{ s.content }}</pre>
            </el-collapse-item>
          </el-collapse>
        </div>

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
/* 子 run（嵌套推理）条目：左侧加色边，配合缩进表达 run 树父子。 */
.raw-item.nested {
  border-left: 3px solid var(--el-color-warning);
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
.llm-stat {
  display: inline-flex;
  gap: 6px;
}
.llm-pill {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}
/* 缓存命中 pill：绿色凸显，与普通耗时/用量 pill 区分。 */
.cache-pill {
  color: var(--el-color-success);
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
.sys-rebuild {
  margin: 12px 0;
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
