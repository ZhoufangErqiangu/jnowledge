<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'
import type { TraceStep } from '@/stores/chat'
import MarkdownContent from '@/components/MarkdownContent.vue'
import CitationTags from '@/components/chat/CitationTags.vue'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'

// 流式草稿气泡：Agent 执行轨迹 + 思考过程 + 增量正文（带闪烁 caret）+ 引用。
defineProps<{
  text: string
  reasoning: string
  citations: Citation[]
  steps: TraceStep[]
}>()
const emit = defineEmits<{ cite: [citation: Citation] }>()
</script>

<template>
  <div class="msg assistant">
    <div class="bubble">
      <!-- Agent 执行轨迹（仅 Agent 模式、流式期间展示） -->
      <el-collapse v-if="steps.length" class="trace" :model-value="['t']">
        <el-collapse-item name="t" :title="`执行轨迹（${steps.length} 步）`">
          <div v-for="s in steps" :key="s.seq" class="trace-step">
            <el-tag
              size="small"
              :type="s.running ? 'info' : s.ok ? 'success' : 'danger'"
              :effect="s.kind === 'agent' ? 'dark' : 'light'"
            >
              {{ s.kind === 'agent' ? '🤖 子agent' : '🔧 工具' }}:{{ s.name }}
            </el-tag>
            <span class="trace-summary">{{ s.running ? '执行中…' : s.summary }}</span>
          </div>
        </el-collapse-item>
      </el-collapse>
      <ReasoningPanel :reasoning="reasoning" />
      <div class="md-line">
        <MarkdownContent :source="text" /><span class="caret">▍</span>
      </div>
      <CitationTags :citations="citations" @select="emit('cite', $event)" />
    </div>
  </div>
</template>

<style scoped lang="less">
.msg {
  display: flex;
  margin-bottom: 14px;
}
.bubble {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.md-line {
  display: inline;
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
.caret {
  animation: blink 1s step-start infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
</style>
