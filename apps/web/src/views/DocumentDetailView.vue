<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDocumentsStore } from '@/stores/documents'
import { useApiAction } from '@/hooks/useApiAction'
import { useCitationHighlight } from '@/hooks/useCitationHighlight'
import { statusTagType } from '@/utils/format'
import DocumentEditor from '@/components/documents/DocumentEditor.vue'
import VersionHistory from '@/components/documents/VersionHistory.vue'
import DocumentSource from '@/components/documents/DocumentSource.vue'
import ChunkList from '@/components/documents/ChunkList.vue'

const route = useRoute()
const router = useRouter()
const docs = useDocumentsStore()
const { run } = useApiAction()
const id = route.params.id as string

const activeTab = ref('edit')
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)

// 原文标签的引用高亮（按 route.query.hl 的精确 char 偏移切分当前版本全文）。
const { sourceParts } = useCitationHighlight(() => docs.viewingVersion?.content)
const viewingVersionNo = computed(() => docs.viewingVersion?.versionNo ?? null)
const sourceRef = ref<InstanceType<typeof DocumentSource> | null>(null)

async function loadAll() {
  await run(async () => {
    const d = await docs.loadDetail(id)
    editTitle.value = d.document.title
    editContent.value = d.currentVersion?.content ?? ''
    await docs.loadVersions(id)
    if (d.currentVersion) await docs.loadVersionChunks(id, d.currentVersion.id)
  }, '加载失败')
}

function selectVersion(versionId: string) {
  run(() => docs.loadVersionChunks(id, versionId), '加载失败')
}

async function save() {
  saving.value = true
  const ok = await run(
    async () => {
      await docs.save(id, { title: editTitle.value, content: editContent.value })
      return true
    },
    '保存失败',
    '已保存，新版本正在后台重新分块',
  )
  if (ok) await loadAll()
  saving.value = false
}

onMounted(async () => {
  await loadAll()
  // 从引用跳转进入：定位到指定版本并切到「原文」高亮。
  const v = route.query.version as string | undefined
  if (v) {
    await run(() => docs.loadVersionChunks(id, v), '加载失败')
    activeTab.value = 'source'
    sourceRef.value?.scrollToHit()
  }
})
</script>

<template>
  <div v-if="docs.detail" class="detail">
    <div class="head">
      <el-button text @click="router.back()">← 返回</el-button>
      <h2 class="title">{{ docs.detail.document.title }}</h2>
      <el-tag :type="statusTagType(docs.detail.document.status)">
        {{ docs.detail.document.status }}
      </el-tag>
      <span class="page-muted">{{ docs.detail.chunkCount }} 个分块</span>
    </div>
    <p v-if="docs.detail.document.statusError" class="err">⚠ {{ docs.detail.document.statusError }}</p>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="编辑" name="edit">
        <DocumentEditor v-model:title="editTitle" v-model:content="editContent" :saving="saving" @save="save" />
      </el-tab-pane>

      <el-tab-pane label="版本历史" name="versions">
        <VersionHistory :versions="docs.versions" @select="selectVersion" />
      </el-tab-pane>

      <el-tab-pane label="原文" name="source">
        <DocumentSource ref="sourceRef" :parts="sourceParts" :version-no="viewingVersionNo" />
      </el-tab-pane>

      <el-tab-pane :label="`分块 (${docs.chunks.length})`" name="chunks">
        <ChunkList :chunks="docs.chunks" :version-no="viewingVersionNo" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped lang="less">
.detail {
  max-width: 980px;
  margin: 0 auto;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  margin: 0;
  flex: 0 1 auto;
}
.err {
  color: #f56c6c;
}
</style>
