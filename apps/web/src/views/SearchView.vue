<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SearchHit } from '@jnowledge/shared'
import { searchApi } from '@/apis/search'
import { useApiAction } from '@/hooks/useApiAction'

// 全局检索：纯相关性排序的文档列表，无 LLM 推理（无会话、无生成、无引用标注）。
const router = useRouter()
const { run } = useApiAction()

const query = ref('')
const hits = ref<SearchHit[]>([])
const loading = ref(false)
// 已执行过一次检索（用于区分「初始态」与「无结果」）。
const searched = ref(false)

async function search() {
  const q = query.value.trim()
  if (!q || loading.value) return
  loading.value = true
  const res = await run(() => searchApi.search(q), '检索失败')
  loading.value = false
  if (res) {
    hits.value = res.hits
    searched.value = true
  }
}

function open(hit: SearchHit) {
  router.push(`/documents/${hit.documentId}`)
}
</script>

<template>
  <el-card class="search" shadow="never">
    <div class="search-bar">
      <el-input
        v-model="query"
        placeholder="跨知识库检索文档（按相关性排序，不经 AI 生成）"
        clearable
        @keydown.enter.prevent="search"
      >
        <template #append>
          <el-button :loading="loading" @click="search">搜索</el-button>
        </template>
      </el-input>
    </div>

    <ul v-if="hits.length > 0" class="hit-list">
      <li v-for="hit in hits" :key="hit.documentId" class="hit" @click="open(hit)">
        <div class="hit-head">
          <span class="hit-title">{{ hit.documentTitle }}</span>
          <el-tag size="small" effect="plain" type="info">{{ hit.collectionName }}</el-tag>
          <span v-if="hit.hitCount > 1" class="hit-count">{{ hit.hitCount }} 处命中</span>
        </div>
        <div v-if="hit.headingPath.length" class="hit-path">{{ hit.headingPath.join(' › ') }}</div>
        <div class="hit-snippet">{{ hit.snippet }}</div>
      </li>
    </ul>

    <el-empty
      v-else-if="searched && !loading"
      description="未检索到相关文档"
      :image-size="80"
    />
    <el-empty
      v-else-if="!searched"
      description="输入关键词，跨你有权访问的知识库检索文档"
      :image-size="80"
    />
  </el-card>
</template>

<style scoped lang="less">
.search {
  height: 100%;
  overflow-y: auto;
}
.search-bar {
  max-width: 720px;
  margin: 8px auto 20px;
}
.hit-list {
  list-style: none;
  margin: 0 auto;
  padding: 0;
  max-width: 720px;
}
.hit {
  padding: 12px 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.hit:hover {
  border-color: var(--el-color-primary);
}
.hit-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hit-title {
  font-weight: 600;
}
.hit-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.hit-path {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.hit-snippet {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
}
</style>
