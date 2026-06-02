<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type {
  Chunk,
  DocumentDetail,
  DocumentVersion,
  DocumentVersionSummary,
} from '@jnowledge/shared'
import { documentsApi } from '@/apis/documents'
import { ApiError } from '@/apis/http'
import { formatDate, statusTagType } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const detail = ref<DocumentDetail | null>(null)
const versions = ref<DocumentVersionSummary[]>([])
const activeTab = ref('edit')

// 编辑态
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)

// 选中版本的分块/全文
const viewingVersion = ref<DocumentVersion | null>(null)
const chunks = ref<Chunk[]>([])

async function loadAll() {
  try {
    detail.value = await documentsApi.detail(id)
    editTitle.value = detail.value.document.title
    editContent.value = detail.value.currentVersion?.content ?? ''
    versions.value = await documentsApi.versions(id)
    const cur = detail.value.currentVersion
    if (cur) await loadVersionChunks(cur.id)
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '加载失败')
  }
}

async function loadVersionChunks(versionId: string) {
  viewingVersion.value = await documentsApi.version(id, versionId)
  const res = await documentsApi.chunks(id, versionId)
  chunks.value = res.items
}

async function save() {
  saving.value = true
  try {
    await documentsApi.update(id, { title: editTitle.value, content: editContent.value })
    ElMessage.success('已保存，新版本正在后台重新分块')
    await loadAll()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <div v-if="detail" class="detail">
    <div class="head">
      <el-button text @click="router.back()">← 返回</el-button>
      <h2 class="title">{{ detail.document.title }}</h2>
      <el-tag :type="statusTagType(detail.document.status)">{{ detail.document.status }}</el-tag>
      <span class="page-muted">{{ detail.chunkCount }} 个分块</span>
    </div>
    <p v-if="detail.document.statusError" class="err">⚠ {{ detail.document.statusError }}</p>

    <el-tabs v-model="activeTab">
      <!-- 编辑 -->
      <el-tab-pane label="编辑" name="edit">
        <el-form label-position="top">
          <el-form-item label="标题">
            <el-input v-model="editTitle" />
          </el-form-item>
          <el-form-item label="正文（Markdown）">
            <el-input v-model="editContent" type="textarea" :rows="18" />
          </el-form-item>
          <el-button type="primary" :loading="saving" @click="save">保存（生成新版本）</el-button>
        </el-form>
      </el-tab-pane>

      <!-- 版本历史 -->
      <el-tab-pane label="版本历史" name="versions">
        <el-table :data="versions" size="small" @row-click="(r: DocumentVersionSummary) => loadVersionChunks(r.id)">
          <el-table-column label="版本" prop="versionNo" width="80" />
          <el-table-column label="校验和" width="160">
            <template #default="{ row }">
              <code>{{ row.checksum.slice(0, 12) }}</code>
            </template>
          </el-table-column>
          <el-table-column label="来源">
            <template #default="{ row }">{{ row.sourceFileId ? '上传' : '手动编辑' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 分块 -->
      <el-tab-pane :label="`分块 (${chunks.length})`" name="chunks">
        <p v-if="viewingVersion" class="page-muted">
          版本 v{{ viewingVersion.versionNo }} 的分块
        </p>
        <el-card v-for="c in chunks" :key="c.id" class="chunk" shadow="never">
          <div class="chunk-meta page-muted">
            #{{ c.seq }} · {{ c.tokenCount }} tokens · 字符 [{{ c.charStart }}, {{ c.charEnd }})
            <span v-if="c.headingPath.length"> · {{ c.headingPath.join(' / ') }}</span>
          </div>
          <pre class="chunk-body">{{ c.content }}</pre>
        </el-card>
        <el-empty v-if="chunks.length === 0" description="暂无分块（可能还在处理中）" />
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
