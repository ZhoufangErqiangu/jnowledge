import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateDocumentRequest, Document } from '@jnowledge/shared'
import { documentsApi } from '@/apis/documents'

export const useDocumentsStore = defineStore('documents', () => {
  const items = ref<Document[]>([])
  const total = ref(0)
  const loading = ref(false)
  const collectionId = ref<string | null>(null)

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

  return { items, total, loading, collectionId, load, reload, createManual, upload, remove }
})
