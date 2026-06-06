<script setup lang="ts">
import type { Chunk } from '@jnowledge/shared'

// 分块列表：展示某版本的分块及其元信息（序号/token/字符区间/标题路径）。
defineProps<{ chunks: Chunk[]; versionNo: number | null }>()
</script>

<template>
  <p v-if="versionNo" class="page-muted">版本 v{{ versionNo }} 的分块</p>
  <el-card v-for="c in chunks" :key="c.id" class="chunk" shadow="never">
    <div class="chunk-meta page-muted">
      #{{ c.seq }} · {{ c.tokenCount }} tokens · 字符 [{{ c.charStart }}, {{ c.charEnd }})
      <span v-if="c.headingPath.length"> · {{ c.headingPath.join(' / ') }}</span>
    </div>
    <pre class="chunk-body">{{ c.content }}</pre>
  </el-card>
  <el-empty v-if="chunks.length === 0" description="暂无分块（可能还在处理中）" />
</template>

<style scoped lang="less">
.chunk {
  margin-bottom: 10px;
}
.chunk-meta {
  font-size: 12px;
  margin-bottom: 6px;
}
.chunk-body {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
}
</style>
