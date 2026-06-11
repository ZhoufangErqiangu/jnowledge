import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  CollectionTreeNode,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from '@jnowledge/shared'
import { collectionsApi } from '@/apis/collections'

export const useCollectionsStore = defineStore('collections', () => {
  const tree = ref<CollectionTreeNode[]>([])
  const loading = ref(false)

  async function loadTree() {
    loading.value = true
    try {
      tree.value = await collectionsApi.tree()
    } finally {
      loading.value = false
    }
  }

  async function create(req: CreateCollectionRequest) {
    const result = await collectionsApi.create(req)
    await loadTree()
    return result
  }

  async function update(id: string, req: UpdateCollectionRequest) {
    await collectionsApi.update(id, req)
    await loadTree()
  }

  async function remove(id: string) {
    await collectionsApi.remove(id)
    await loadTree()
  }

  return { tree, loading, loadTree, create, update, remove }
})
