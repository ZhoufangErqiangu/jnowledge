<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CollectionTreeNode } from '@jnowledge/shared'
import { RefreshCw, Users, FilePlus, Upload } from 'lucide-vue-next'
import { useCollectionsStore } from '@/stores/collections'
import { useDocumentsStore } from '@/stores/documents'
import { useApiAction } from '@/hooks/useApiAction'
import { useConfirmDelete } from '@/hooks/useConfirmDelete'
import { usePolling } from '@/hooks/usePolling'
import { isProcessing } from '@/utils/format'
import CollectionTree from '@/components/collections/CollectionTree.vue'
import DocumentTable from '@/components/collections/DocumentTable.vue'
import CreateCollectionDialog from '@/components/collections/CreateCollectionDialog.vue'
import DocCreateDialog from '@/components/collections/DocCreateDialog.vue'
import MembersDialog from '@/components/MembersDialog.vue'
import Button from '@/components/ui/Button.vue'

const router = useRouter()
const collections = useCollectionsStore()
const documents = useDocumentsStore()
const { run } = useApiAction()
const { confirmDelete } = useConfirmDelete()

const selectedId = ref<string | null>(null)

onMounted(() => collections.loadTree())

watch(selectedId, (id) => {
  if (id) documents.load(id)
})

const createVisible = ref(false)
const createParentId = ref<string | null>(null)
function openCreate(parentId: string | null) {
  createParentId.value = parentId
  createVisible.value = true
}
async function submitCreate(name: string) {
  const ok = await run(
    () => collections.create({ name, ...(createParentId.value ? { parentId: createParentId.value } : {}) }),
    '创建失败',
  )
  if (ok !== undefined) createVisible.value = false
}
function removeCollection(node: CollectionTreeNode) {
  confirmDelete(`确认删除知识库「${node.name}」？`, async () => {
    await collections.remove(node.id)
    if (selectedId.value === node.id) selectedId.value = null
  })
}

const membersVisible = ref(false)
const docVisible = ref(false)
async function submitDoc(payload: { title: string; content: string }) {
  if (!selectedId.value) return
  const ok = await run(
    () => documents.createManual({ collectionId: selectedId.value!, ...payload }),
    '创建失败',
  )
  if (ok !== undefined) docVisible.value = false
}

const fileInput = ref<HTMLInputElement>()
function httpRequest(opt: { file: File }) {
  if (!selectedId.value) return
  return run(() => documents.upload(selectedId.value!, opt.file), '上传失败', '已受理，正在后台解析')
}
function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) httpRequest({ file })
  if (fileInput.value) fileInput.value.value = ''
}

function removeDoc(id: string) {
  confirmDelete('确认删除该文档？', () => documents.remove(id))
}

const hasProcessing = computed(() => documents.items.some((d) => isProcessing(d.status)))
usePolling(hasProcessing, () => documents.reload(), 2000)
</script>

<template>
  <div class="grid h-full gap-4" style="grid-template-columns: 300px 1fr">
    <CollectionTree :tree="collections.tree" :loading="collections.loading" :selected-id="selectedId"
      @select="selectedId = $event" @create="openCreate" @remove="removeCollection" />

    <!-- Document pane -->
    <div class="flex flex-col h-full rounded-xl border border-white/[0.06] bg-surface/60 overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.05] shrink-0">
        <span class="font-semibold text-sm text-white/80">文档</span>
        <div class="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!selectedId" @click="membersVisible = true">
            <Users :size="13" />成员
          </Button>
          <Button variant="ghost" size="sm" class="gap-1.5" :disabled="!selectedId" @click="docVisible = true">
            <FilePlus :size="13" />新建文档
          </Button>
          <Button size="sm" class="gap-1.5" :disabled="!selectedId" @click="fileInput?.click()">
            <Upload :size="13" />上传文件
          </Button>
          <input ref="fileInput" type="file" class="hidden" @change="handleFileChange" />
          <Button variant="ghost" size="sm" :disabled="!selectedId" @click="documents.reload()">
            <RefreshCw :size="13" />
          </Button>
        </div>
      </div>

      <div class="flex-1 overflow-auto p-4">
        <div v-if="!selectedId" class="flex items-center justify-center h-full text-white/30 text-sm">
          请选择左侧知识库
        </div>
        <DocumentTable v-else :documents="documents.items" :loading="documents.loading"
          @open="(row) => router.push(`/documents/${row.id}`)" @remove="removeDoc" />
      </div>
    </div>

    <CreateCollectionDialog v-model="createVisible" :parent-id="createParentId" @submit="submitCreate" />
    <DocCreateDialog v-model="docVisible" @submit="submitDoc" />
    <MembersDialog v-model="membersVisible" :collection-id="selectedId" />
  </div>
</template>
