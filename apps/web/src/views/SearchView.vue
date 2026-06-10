<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from 'lucide-vue-next'
import type { SearchHit } from '@jnowledge/shared'
import { searchApi } from '@/apis/search'
import { useApiAction } from '@/hooks/useApiAction'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

const router = useRouter()
const route = useRoute()
const { run } = useApiAction()

const query = ref((route.query.query as string) ?? '')
const hits = ref<SearchHit[]>([])
const loading = ref(false)
const searched = ref(false)

// URL 是检索词的真相源：提交即写入 ?query=，由 watch 触发实际检索，
// 这样直接访问 /search?query=xxx 或前进/后退都能复现结果。
function search() {
  const q = query.value.trim()
  if (!q) return
  router.push({ name: 'search', query: { query: q } })
}

async function exec(q: string) {
  if (loading.value) return
  loading.value = true
  const res = await run(() => searchApi.search(q), '检索失败')
  loading.value = false
  if (res) {
    hits.value = res.hits
    searched.value = true
  }
}

watch(
  () => route.query.query,
  (raw) => {
    const q = ((raw as string) ?? '').trim()
    query.value = q
    if (q) {
      exec(q)
    } else {
      hits.value = []
      searched.value = false
    }
  },
  { immediate: true },
)

function open(hit: SearchHit) {
  router.push(`/documents/${hit.documentId}`)
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <!-- Search bar -->
    <div class="max-w-[720px] mx-auto mt-2 mb-6">
      <div class="flex gap-2">
        <div class="flex-1 relative">
          <Search
            :size="15"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
          />
          <input
            v-model="query"
            placeholder="跨知识库检索文档（按相关性排序，不经 AI 生成）"
            class="w-full h-9 pl-9 pr-3 rounded-md border border-white/[0.1] bg-white/[0.04] text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-brand/50 focus:border-brand/40 transition-all duration-150"
            @keydown.enter.prevent="search"
          />
        </div>
        <Button :loading="loading" @click="search">搜索</Button>
      </div>
    </div>

    <!-- Results -->
    <ul v-if="hits.length > 0" class="max-w-[720px] mx-auto space-y-2">
      <li
        v-for="hit in hits"
        :key="hit.documentId"
        class="p-4 rounded-xl border border-white/[0.07] bg-surface/50 cursor-pointer hover:border-brand/30 hover:shadow-[0_0_0_1px_rgba(99,102,241,0.1)] hover:bg-surface/80 transition-all duration-150"
        @click="open(hit)"
      >
        <div class="flex items-center gap-2 mb-1">
          <span class="font-semibold text-white/90 text-sm">{{ hit.documentTitle }}</span>
          <Badge>{{ hit.collectionName }}</Badge>
          <span v-if="hit.hitCount > 1" class="text-xs text-white/40">{{ hit.hitCount }} 处命中</span>
        </div>
        <div v-if="hit.headingPath.length" class="text-xs text-white/40 mb-1">
          {{ hit.headingPath.join(' › ') }}
        </div>
        <div class="text-sm text-white/60 leading-relaxed">{{ hit.snippet }}</div>
      </li>
    </ul>

    <div
      v-else-if="searched && !loading"
      class="flex flex-col items-center justify-center py-16 gap-2 text-white/30"
    >
      <Search :size="32" class="opacity-30" />
      <span class="text-sm">未检索到相关文档</span>
    </div>
    <div
      v-else-if="!searched"
      class="flex flex-col items-center justify-center py-16 gap-2 text-white/30"
    >
      <Search :size="32" class="opacity-30" />
      <span class="text-sm">输入关键词，跨你有权访问的知识库检索文档</span>
    </div>
  </div>
</template>
