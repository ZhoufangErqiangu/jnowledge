<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { useDocumentsStore } from '@/stores/documents'
import { useApiAction } from '@/hooks/useApiAction'
import { useCitationHighlight } from '@/hooks/useCitationHighlight'
import DocumentEditor from '@/components/documents/DocumentEditor.vue'
import VersionHistory from '@/components/documents/VersionHistory.vue'
import DocumentSource from '@/components/documents/DocumentSource.vue'
import ChunkList from '@/components/documents/ChunkList.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import Button from '@/components/ui/Button.vue'
import Tabs from '@/components/ui/Tabs.vue'
import TabsList from '@/components/ui/TabsList.vue'
import TabsTrigger from '@/components/ui/TabsTrigger.vue'
import TabsContent from '@/components/ui/TabsContent.vue'

const route = useRoute()
const router = useRouter()
const docs = useDocumentsStore()
const { run } = useApiAction()
const id = route.params.id as string

const activeTab = ref('edit')
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)

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
  const v = route.query.version as string | undefined
  if (v) {
    await run(() => docs.loadVersionChunks(id, v), '加载失败')
    activeTab.value = 'source'
    sourceRef.value?.scrollToHit()
  }
})
</script>

<template>
  <div v-if="docs.detail" class="max-w-[980px] mx-auto">
    <div class="flex items-center gap-3 mb-4">
      <Button variant="ghost" size="sm" class="gap-1.5" @click="router.back()">
        <ArrowLeft :size="14" />返回
      </Button>
      <h2 class="text-lg font-semibold text-white/90 flex-1 truncate m-0">
        {{ docs.detail.document.title }}
      </h2>
      <StatusBadge :status="docs.detail.document.status" />
      <span class="text-xs text-white/40">{{ docs.detail.chunkCount }} 个分块</span>
    </div>
    <p v-if="docs.detail.document.statusError" class="text-sm text-red-400 mb-3">
      ⚠ {{ docs.detail.document.statusError }}
    </p>

    <Tabs v-model="activeTab">
      <TabsList>
        <TabsTrigger value="edit">编辑</TabsTrigger>
        <TabsTrigger value="versions">版本历史</TabsTrigger>
        <TabsTrigger value="source">原文</TabsTrigger>
        <TabsTrigger value="chunks">分块 ({{ docs.chunks.length }})</TabsTrigger>
      </TabsList>

      <TabsContent value="edit">
        <DocumentEditor v-model:title="editTitle" v-model:content="editContent" :saving="saving" @save="save" />
      </TabsContent>
      <TabsContent value="versions">
        <VersionHistory :versions="docs.versions" @select="selectVersion" />
      </TabsContent>
      <TabsContent value="source">
        <DocumentSource ref="sourceRef" :parts="sourceParts" :version-no="viewingVersionNo" />
      </TabsContent>
      <TabsContent value="chunks">
        <ChunkList :chunks="docs.chunks" :version-no="viewingVersionNo" />
      </TabsContent>
    </Tabs>
  </div>
</template>
