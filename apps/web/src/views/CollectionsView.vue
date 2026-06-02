<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { CollectionTreeNode, Document } from '@jnowledge/shared'
import { useCollectionsStore } from '@/stores/collections'
import { useDocumentsStore } from '@/stores/documents'
import { ApiError } from '@/apis/http'
import MembersDialog from '@/components/MembersDialog.vue'
import { formatDate, isProcessing, statusTagType } from '@/utils/format'

const router = useRouter()
const collections = useCollectionsStore()
const documents = useDocumentsStore()

const selectedId = ref<string | null>(null)
const treeProps = { label: 'name', children: 'children' }

onMounted(() => collections.loadTree())

// 选中知识库 → 加载其文档
watch(selectedId, (id) => {
  if (id) documents.load(id)
})

function onNodeClick(node: CollectionTreeNode) {
  selectedId.value = node.id
}

function goDoc(row: Document) {
  router.push(`/documents/${row.id}`)
}

// ---- 新建知识库 ----
const createDialog = reactive({ visible: false, name: '', parentId: null as string | null })
function openCreate(parentId: string | null = null) {
  createDialog.name = ''
  createDialog.parentId = parentId
  createDialog.visible = true
}
async function submitCreate() {
  if (!createDialog.name.trim()) return
  try {
    await collections.create({
      name: createDialog.name.trim(),
      ...(createDialog.parentId ? { parentId: createDialog.parentId } : {}),
    })
    createDialog.visible = false
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '创建失败')
  }
}

async function removeCollection(node: CollectionTreeNode) {
  await ElMessageBox.confirm(`确认删除知识库「${node.name}」？`, '提示', { type: 'warning' })
  try {
    await collections.remove(node.id)
    if (selectedId.value === node.id) selectedId.value = null
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败')
  }
}

// ---- 成员 ----
const membersDialog = reactive({ visible: false })

// ---- 新建/上传文档 ----
const docDialog = reactive({ visible: false, title: '', content: '' })
function openDocDialog() {
  docDialog.title = ''
  docDialog.content = ''
  docDialog.visible = true
}
async function submitDoc() {
  if (!selectedId.value || !docDialog.title.trim()) return
  try {
    await documents.createManual({
      collectionId: selectedId.value,
      title: docDialog.title.trim(),
      content: docDialog.content,
    })
    docDialog.visible = false
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '创建失败')
  }
}

async function onUpload(file: File) {
  if (!selectedId.value) return
  try {
    await documents.upload(selectedId.value, file)
    ElMessage.success('已受理，正在后台解析')
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '上传失败')
  }
}
// el-upload http-request 钩子
function httpRequest(opt: { file: File }) {
  return onUpload(opt.file)
}

async function removeDoc(id: string) {
  await ElMessageBox.confirm('确认删除该文档？', '提示', { type: 'warning' })
  try {
    await documents.remove(id)
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '删除失败')
  }
}

// 处理中文档轮询刷新
const hasProcessing = computed(() => documents.items.some((d) => isProcessing(d.status)))
let timer: ReturnType<typeof setInterval> | null = null
watch(hasProcessing, (processing) => {
  if (processing && !timer) {
    timer = setInterval(() => documents.reload(), 2000)
  } else if (!processing && timer) {
    clearInterval(timer)
    timer = null
  }
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="cols">
    <!-- 左：知识库树 -->
    <el-card class="tree-pane" shadow="never">
      <template #header>
        <div class="pane-head">
          <span>知识库</span>
          <el-button text type="primary" @click="openCreate(null)">+ 新建</el-button>
        </div>
      </template>
      <el-tree
        v-loading="collections.loading"
        :data="collections.tree"
        :props="treeProps"
        node-key="id"
        highlight-current
        @node-click="onNodeClick"
      >
        <template #default="{ data }">
          <span class="tree-node">
            <span>{{ data.name }}</span>
            <span class="tree-actions">
              <el-button text size="small" @click.stop="openCreate(data.id)">子库</el-button>
              <el-button text size="small" type="danger" @click.stop="removeCollection(data)">
                删
              </el-button>
            </span>
          </span>
        </template>
      </el-tree>
      <el-empty v-if="!collections.loading && collections.tree.length === 0" description="暂无知识库" />
    </el-card>

    <!-- 右：文档面板 -->
    <el-card class="doc-pane" shadow="never">
      <template #header>
        <div class="pane-head">
          <span>文档</span>
          <div v-if="selectedId" class="head-actions">
            <el-button text type="primary" @click="router.push(`/collections/${selectedId}/chat`)">
              问答
            </el-button>
            <el-button text type="primary" @click="membersDialog.visible = true">成员</el-button>
            <el-button text type="primary" @click="openDocDialog">新建文档</el-button>
            <el-upload :show-file-list="false" :http-request="httpRequest">
              <el-button type="primary" size="small">上传文件</el-button>
            </el-upload>
            <el-button text @click="documents.reload()">刷新</el-button>
          </div>
        </div>
      </template>

      <el-empty v-if="!selectedId" description="请选择左侧知识库" />
      <template v-else>
        <el-table v-loading="documents.loading" :data="documents.items" @row-click="goDoc">
          <el-table-column label="标题" prop="title" />
          <el-table-column label="来源" prop="sourceType" width="90" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80">
            <template #default="{ row }">
              <el-button text type="danger" size="small" @click.stop="removeDoc(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!documents.loading && documents.items.length === 0" description="暂无文档" />
      </template>
    </el-card>

    <!-- 新建知识库 -->
    <el-dialog v-model="createDialog.visible" title="新建知识库" width="420">
      <el-form label-position="top">
        <el-form-item label="名称">
          <el-input v-model="createDialog.name" placeholder="知识库名称" />
        </el-form-item>
        <p v-if="createDialog.parentId" class="page-muted">将创建为所选库的子库</p>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 新建文档 -->
    <el-dialog v-model="docDialog.visible" title="新建文档" width="640">
      <el-form label-position="top">
        <el-form-item label="标题">
          <el-input v-model="docDialog.title" placeholder="文档标题" />
        </el-form-item>
        <el-form-item label="正文（Markdown）">
          <el-input v-model="docDialog.content" type="textarea" :rows="12" placeholder="# 标题…" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="docDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="submitDoc">创建</el-button>
      </template>
    </el-dialog>

    <MembersDialog v-model="membersDialog.visible" :collection-id="selectedId" />
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
.tree-node {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}
.tree-actions {
  opacity: 0.6;
}
:deep(.el-table__row) {
  cursor: pointer;
}
</style>
