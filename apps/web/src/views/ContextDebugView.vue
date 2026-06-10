<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronDown, Info } from 'lucide-vue-next'
import type { ContextDebug, ContextItemDebug } from '@jnowledge/shared'
import { chatApi } from '@/apis/chat'
import { useApiAction } from '@/hooks/useApiAction'
import Button from '@/components/ui/Button.vue'
import Tabs from '@/components/ui/Tabs.vue'
import TabsList from '@/components/ui/TabsList.vue'
import TabsTrigger from '@/components/ui/TabsTrigger.vue'
import TabsContent from '@/components/ui/TabsContent.vue'
import { cn } from '@/lib/utils'

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

const KIND_CLS: Record<ContextItemDebug['kind'], string> = {
  user:        'bg-brand/15 text-brand/90 border-brand/25',
  assistant:   'bg-green-500/15 text-green-400 border-green-500/25',
  tool_result: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
}

const STATE_CLS: Record<string, string> = {
  active:   'bg-green-500/15 text-green-400 border-green-500/25',
  hidden:   'bg-gray-500/15 text-gray-400 border-gray-500/25',
  internal: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
}

const runById = computed(() => new Map(runs.value.map((r) => [r.id, r])))

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

interface LlmStat {
  durationMs: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedPromptTokens?: number }
}
function llmStat(it: ContextItemDebug): LlmStat | null {
  const llm = it.meta.llm as LlmStat | undefined
  return llm && typeof llm.durationMs === 'number' ? llm : null
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function fmtTokens(n: number): string {
  return n.toLocaleString()
}

const STAGE_LABEL: Record<string, string> = {
  safety: '安全裁决',
  rag_filter: 'RAG 过滤',
  system: 'system 前缀',
  scope: '作用域后缀',
}

const internalItems = computed(() => raw.value.filter((it) => it.flags.state === 'internal'))

function stageOf(it: ContextItemDebug): string {
  const stage = it.meta.stage
  if (typeof stage === 'string' && STAGE_LABEL[stage]) return STAGE_LABEL[stage]
  return '子推理'
}

// Per-item collapse state for meta panels
const metaOpen = ref(new Map<string, boolean>())
function toggleMeta(id: string) {
  metaOpen.value.set(id, !metaOpen.value.get(id))
}

const sysPanelOpen = ref<boolean[]>([])
</script>

<template>
  <div class="h-full overflow-auto px-2 py-1">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-3">
      <Button variant="ghost" size="sm" class="gap-1.5" @click="router.back()">
        <ArrowLeft :size="14" />返回
      </Button>
      <div v-if="data" class="flex items-center gap-2 flex-1">
        <span class="font-semibold text-white/90 text-sm">{{ data.conversation.title }}</span>
        <span
          class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border bg-brand/15 text-brand/80 border-brand/25"
        >
          {{ data.conversation.collectionId ? '知识库会话' : '全局会话' }}
        </span>
        <code class="text-xs text-white/30 font-mono">{{ conversationId }}</code>
      </div>
    </div>

    <p class="text-xs text-white/40 mb-4 leading-relaxed">
      同一份<strong class="text-white/60">原始上下文</strong>（context_items 全量事件日志）派生出
      <strong class="text-white/60">推理视图</strong>（喂给 LLM）与<strong class="text-white/60">用户视图</strong>（前端可见聊天）；
      <strong class="text-white/60">非主线推理</strong>单列裁决 / 过滤 / 快照等 internal 留痕。
    </p>

    <Tabs default-value="raw">
      <TabsList>
        <TabsTrigger value="raw">原始上下文 ({{ raw.length }})</TabsTrigger>
        <TabsTrigger value="internal">非主线推理 ({{ internalItems.length }})</TabsTrigger>
        <TabsTrigger value="llm">推理视图 ({{ llmView.length }})</TabsTrigger>
        <TabsTrigger value="user">用户视图 ({{ userView.length }})</TabsTrigger>
      </TabsList>

      <!-- Raw Context -->
      <TabsContent value="raw">
        <div v-if="!raw.length" class="text-white/30 text-sm py-4">暂无上下文条目。</div>
        <ol class="space-y-3">
          <li
            v-for="(it, i) in raw"
            :key="it.id"
            :style="{ marginLeft: `${itemDepth(it) * 20}px` }"
            :class="
              cn(
                'border rounded-xl p-3',
                itemDepth(it) > 0
                  ? 'border-l-2 border-l-yellow-500/50 border-white/[0.06]'
                  : 'border-white/[0.06]',
                'bg-surface/40',
              )
            "
          >
            <div class="flex items-center flex-wrap gap-2 mb-2">
              <span class="text-xs font-semibold text-white/40">#{{ i + 1 }}</span>
              <span :class="cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', KIND_CLS[it.kind] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/25')">{{ it.kind }}</span>
              <span :class="cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', STATE_CLS[it.flags.state] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/25')">{{ it.flags.state }}</span>
              <span v-if="it.meta.stage" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/25">{{ it.meta.stage }}</span>
              <span v-if="agentNameOf(it.runId)" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-brand/15 text-brand/80 border-brand/25">{{ agentNameOf(it.runId) }}</span>
              <span v-if="llmStat(it)" class="flex items-center gap-1.5">
                <span class="text-[10px] text-white/40 bg-white/[0.04] rounded px-1.5 py-0.5 font-mono">⏱ {{ fmtDuration(llmStat(it)!.durationMs) }}</span>
                <span v-if="llmStat(it)!.usage" class="text-[10px] text-white/40 bg-white/[0.04] rounded px-1.5 py-0.5 font-mono">🔢 {{ fmtTokens(llmStat(it)!.usage!.totalTokens) }} tok</span>
                <span v-if="llmStat(it)!.usage?.cachedPromptTokens" class="text-[10px] text-green-400 bg-green-500/10 rounded px-1.5 py-0.5 font-mono">💾 {{ fmtTokens(llmStat(it)!.usage!.cachedPromptTokens!) }} tok</span>
              </span>
              <span class="ml-auto text-[10px] text-white/30">{{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>

            <pre class="text-xs text-white/70 whitespace-pre-wrap break-words leading-relaxed m-0 font-sans mb-2">{{ it.content || '（空文本——多为纯工具调用轮）' }}</pre>

            <div v-if="it.citations.length" class="mb-2">
              <span class="text-[10px] font-semibold text-white/40">citations ({{ it.citations.length }})</span>
              <pre class="mt-1 p-2 bg-white/[0.03] rounded-lg text-[10px] text-white/50 whitespace-pre-wrap break-words font-mono">{{ pretty(it.citations) }}</pre>
            </div>

            <div v-if="hasMeta(it.meta)" class="rounded-lg border border-white/[0.05] overflow-hidden">
              <button
                class="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
                @click="toggleMeta(it.id)"
              >
                <span>meta（工具调用 / 执行轨迹 / 思考过程）</span>
                <ChevronDown :size="10" :class="cn('transition-transform', metaOpen.get(it.id) && 'rotate-180')" />
              </button>
              <div v-show="metaOpen.get(it.id)" class="px-3 pb-2">
                <pre class="text-[10px] text-white/50 whitespace-pre-wrap break-words font-mono">{{ pretty(it.meta) }}</pre>
              </div>
            </div>
          </li>
        </ol>
      </TabsContent>

      <!-- Internal (non-mainline) -->
      <TabsContent value="internal">
        <div class="flex gap-2 p-3 rounded-lg bg-brand/[0.06] border border-brand/15 text-xs text-white/60 mb-4">
          <Info :size="14" class="text-brand/70 shrink-0 mt-0.5" />
          <div>
            <strong class="text-white/80">非主线推理：安全裁决 / RAG 过滤 / system 快照 / 子 agent</strong>
            <br />这些是 internal 状态条目——留痕于原始上下文供审计，但被各视图按需排除。
          </div>
        </div>
        <div v-if="!internalItems.length" class="text-white/30 text-sm py-4">暂无非主线推理条目。</div>
        <ol class="space-y-3">
          <li
            v-for="it in internalItems"
            :key="it.id"
            class="border border-l-2 border-l-yellow-500/50 border-white/[0.06] rounded-xl p-3 bg-surface/40"
          >
            <div class="flex items-center flex-wrap gap-2 mb-2">
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-yellow-500/15 text-yellow-400 border-yellow-500/25">{{ stageOf(it) }}</span>
              <span v-if="agentNameOf(it.runId)" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-brand/15 text-brand/80 border-brand/25">{{ agentNameOf(it.runId) }}</span>
              <span class="ml-auto text-[10px] text-white/30">{{ new Date(it.createdAt).toLocaleString() }}</span>
            </div>
            <pre class="text-xs text-white/70 whitespace-pre-wrap break-words leading-relaxed m-0 font-sans mb-2">{{ it.content || '（空文本）' }}</pre>
            <div v-if="it.meta.verdict" class="mb-2">
              <span class="text-[10px] font-semibold text-white/40">裁决 / 明细</span>
              <pre class="mt-1 p-2 bg-white/[0.03] rounded-lg text-[10px] text-white/50 whitespace-pre-wrap font-mono">{{ pretty(it.meta.verdict) }}</pre>
            </div>
            <div v-if="hasMeta(it.meta)" class="rounded-lg border border-white/[0.05] overflow-hidden">
              <button
                class="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
                @click="toggleMeta(it.id + '_i')"
              >
                <span>meta（完整）</span>
                <ChevronDown :size="10" :class="cn('transition-transform', metaOpen.get(it.id + '_i') && 'rotate-180')" />
              </button>
              <div v-show="metaOpen.get(it.id + '_i')" class="px-3 pb-2">
                <pre class="text-[10px] text-white/50 whitespace-pre-wrap break-words font-mono">{{ pretty(it.meta) }}</pre>
              </div>
            </div>
          </li>
        </ol>
      </TabsContent>

      <!-- LLM View -->
      <TabsContent value="llm">
        <div class="flex gap-2 p-3 rounded-lg bg-brand/[0.06] border border-brand/15 text-xs text-white/60 mb-4">
          <Info :size="14" class="text-brand/70 shrink-0 mt-0.5" />
          <div>
            <strong class="text-white/80">此为投影引擎从原始上下文派生的跨轮历史</strong>
            <br />system 实际发送值随轮快照落库，忠实于发送当时。
          </div>
        </div>

        <!-- System prompt snapshots -->
        <div v-if="systemView.length" class="mb-4">
          <span class="text-xs font-semibold text-white/40 mb-2 block">system prompt 快照</span>
          <div class="space-y-2">
            <div
              v-for="(s, idx) in systemView"
              :key="idx"
              class="rounded-lg border border-white/[0.05] overflow-hidden"
            >
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/50 hover:text-white/70 transition-colors"
                @click="sysPanelOpen[idx] = !sysPanelOpen[idx]"
              >
                <span :class="cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', s.stage === 'scope' ? 'bg-green-500/15 text-green-400 border-green-500/25' : 'bg-brand/15 text-brand/80 border-brand/25')">{{ STAGE_LABEL[s.stage] ?? s.stage }}</span>
                <span>{{ s.label }}</span>
                <ChevronDown :size="10" :class="cn('ml-auto transition-transform', sysPanelOpen[idx] && 'rotate-180')" />
              </button>
              <div v-show="sysPanelOpen[idx]" class="px-3 pb-2">
                <pre class="text-xs text-white/60 whitespace-pre-wrap break-words font-sans leading-relaxed">{{ s.content }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <div
            v-for="(m, i) in llmView"
            :key="i"
            :class="cn('border-l-2 pl-3 py-1', m.role === 'user' ? 'border-brand/60' : m.role === 'assistant' ? 'border-green-500/60' : 'border-brand/30')"
          >
            <span :class="cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border mb-1', m.role === 'user' ? 'bg-brand/15 text-brand/80 border-brand/25' : m.role === 'assistant' ? 'bg-green-500/15 text-green-400 border-green-500/25' : 'bg-gray-500/15 text-gray-400 border-gray-500/25')">{{ m.role }}</span>
            <pre class="text-xs text-white/70 whitespace-pre-wrap break-words font-sans leading-relaxed m-0">{{ m.content }}</pre>
          </div>
        </div>
      </TabsContent>

      <!-- User View -->
      <TabsContent value="user">
        <div class="space-y-3">
          <div
            v-for="m in userView"
            :key="m.id"
            :class="cn('border-l-2 pl-3 py-1', m.role === 'user' ? 'border-brand/60' : m.role === 'assistant' ? 'border-green-500/60' : 'border-brand/30')"
          >
            <span :class="cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border mb-1', m.role === 'user' ? 'bg-brand/15 text-brand/80 border-brand/25' : m.role === 'assistant' ? 'bg-green-500/15 text-green-400 border-green-500/25' : 'bg-gray-500/15 text-gray-400 border-gray-500/25')">{{ m.role }}</span>
            <pre class="text-xs text-white/70 whitespace-pre-wrap break-words font-sans leading-relaxed m-0">{{ m.content }}</pre>
            <div v-if="m.citations.length" class="text-[10px] text-white/30 mt-1">citations ({{ m.citations.length }})</div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
