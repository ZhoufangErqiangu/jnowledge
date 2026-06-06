import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  Chunk,
  CreateDocumentRequest,
  Document,
  DocumentDetail,
  DocumentVersion,
  DocumentVersionSummary,
  UpdateDocumentRequest,
} from '@jnowledge/shared'
import { documentsApi } from '@/apis/documents'

export const useDocumentsStore = defineStore('documents', () => {
  // ---- 列表态（CollectionsView） ----
  const items = ref<Document[]>([])
  const total = ref(0)
  const loading = ref(false)
  const collectionId = ref<string | null>(null)

  // ---- 详情态（DocumentDetailView） ----
  const detail = ref<DocumentDetail | null>(null)
  const versions = ref<DocumentVersionSummary[]>([])
  const viewingVersion = ref<DocumentVersion | null>(null)
  const chunks = ref<Chunk[]>([])

  async function load(cid: string, page = 1, pageSize = 20) {
    collectionId.value = cid
    loading.value = true
    try {
      const res = await documentsApi.listByCollection(cid, page, pageSize)
      items.value = res.items
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  async function reload() {
    if (collectionId.value) await load(collectionId.value)
  }

  async function createManual(req: CreateDocumentRequest) {
    await documentsApi.createManual(req)
    await reload()
  }

  async function upload(cid: string, file: File) {
    await documentsApi.upload(cid, file)
    await reload()
  }

  async function remove(id: string) {
    await documentsApi.remove(id)
    await reload()
  }

  async function loadDetail(id: string) {
    detail.value = await documentsApi.detail(id)
    return detail.value
  }

  async function loadVersions(id: string) {
    versions.value = await documentsApi.versions(id)
    return versions.value
  }

  /** 加载某版本的全文 + 分块，填充 viewingVersion / chunks。 */
  async function loadVersionChunks(id: string, versionId: string) {
    viewingVersion.value = await documentsApi.version(id, versionId)
    chunks.value = (await documentsApi.chunks(id, versionId)).items
  }

  /** 保存正文 → 触发新版本与后台重分块（不在此处刷新，由调用方决定后续加载）。 */
  async function save(id: string, req: UpdateDocumentRequest) {
    await documentsApi.update(id, req)
  }

  return {
    items,
    total,
    loading,
    collectionId,
    detail,
    versions,
    viewingVersion,
    chunks,
    load,
    reload,
    createManual,
    upload,
    remove,
    loadDetail,
    loadVersions,
    loadVersionChunks,
    save,
  }
})
