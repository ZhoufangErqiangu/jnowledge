<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CollectionTreeNode } from '@jnowledge/shared'
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

const router = useRouter()
const collections = useCollectionsStore()
const documents = useDocumentsStore()
const { run } = useApiAction()
const { confirmDelete } = useConfirmDelete()

const selectedId = ref<string | null>(null)

onMounted(() => collections.loadTree())

// 选中知识库 → 加载其文档
watch(selectedId, (id) => {
  if (id) documents.load(id)
})

// ---- 知识库：新建 / 删除 ----
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

// ---- 成员 ----
const membersVisible = ref(false)

// ---- 文档：新建 / 上传 / 删除 ----
const docVisible = ref(false)
async function submitDoc(payload: { title: string; content: string }) {
  if (!selectedId.value) return
  const ok = await run(
    () => documents.createManual({ collectionId: selectedId.value!, ...payload }),
    '创建失败',
  )
  if (ok !== undefined) docVisible.value = false
}

// el-upload http-request 钩子
function httpRequest(opt: { file: File }) {
  if (!selectedId.value) return
  return run(() => documents.upload(selectedId.value!, opt.file), '上传失败', '已受理，正在后台解析')
}

function removeDoc(id: string) {
  confirmDelete('确认删除该文档？', () => documents.remove(id))
}

// 处理中文档轮询刷新
const hasProcessing = computed(() => documents.items.some((d) => isProcessing(d.status)))
usePolling(hasProcessing, () => documents.reload(), 2000)
</script>

<template>
  <div class="cols">
    <CollectionTree
      :tree="collections.tree"
      :loading="collections.loading"
      @select="selectedId = $event"
      @create="openCreate"
      @remove="removeCollection"
    />

    <!-- 右：文档面板 -->
    <el-card class="doc-pane" shadow="never">
      <template #header>
        <div class="pane-head">
          <span>文档</span>
          <div v-if="selectedId" class="head-actions">
            <el-button text type="primary" @click="router.push(`/collections/${selectedId}/chat`)">
              问答
            </el-button>
            <el-button text type="primary" @click="membersVisible = true">成员</el-button>
            <el-button text type="primary" @click="docVisible = true">新建文档</el-button>
            <el-upload :show-file-list="false" :http-request="httpRequest">
              <el-button type="primary" size="small">上传文件</el-button>
            </el-upload>
            <el-button text @click="documents.reload()">刷新</el-button>
          </div>
        </div>
      </template>

      <el-empty v-if="!selectedId" description="请选择左侧知识库" />
      <DocumentTable
        v-else
        :documents="documents.items"
        :loading="documents.loading"
        @open="(row) => router.push(`/documents/${row.id}`)"
        @remove="removeDoc"
      />
    </el-card>

    <CreateCollectionDialog
      v-model="createVisible"
      :parent-id="createParentId"
      @submit="submitCreate"
    />
    <DocCreateDialog v-model="docVisible" @submit="submitDoc" />
    <MembersDialog v-model="membersVisible" :collection-id="selectedId" />
  </div>
</template>

<style scoped lang="less">
.cols {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
  height: 100%;
}
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
