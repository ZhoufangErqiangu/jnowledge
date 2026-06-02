import type {
  Chunk,
  CreateDocumentRequest,
  Document,
  DocumentDetail,
  DocumentVersion,
  DocumentVersionSummary,
  UpdateDocumentRequest,
} from '@jnowledge/shared'
import { http } from './http'

interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export const documentsApi = {
  async listByCollection(
    collectionId: string,
    page = 1,
    pageSize = 20,
  ): Promise<Paginated<Document>> {
    const { data } = await http.get<Paginated<Document>>(
      `/collections/${collectionId}/documents`,
      { params: { page, pageSize } },
    )
    return data
  },
  async createManual(req: CreateDocumentRequest): Promise<Document> {
    const { data } = await http.post<Document>('/documents', req)
    return data
  },
  async upload(collectionId: string, file: File): Promise<Document> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await http.post<Document>(
      `/collections/${collectionId}/documents/upload`,
      form,
    )
    return data
  },
  async detail(id: string): Promise<DocumentDetail> {
    const { data } = await http.get<DocumentDetail>(`/documents/${id}`)
    return data
  },
  async update(id: string, req: UpdateDocumentRequest): Promise<Document> {
    const { data } = await http.patch<Document>(`/documents/${id}`, req)
    return data
  },
  async remove(id: string): Promise<void> {
    await http.delete(`/documents/${id}`)
  },
  async versions(id: string): Promise<DocumentVersionSummary[]> {
    const { data } = await http.get<DocumentVersionSummary[]>(`/documents/${id}/versions`)
    return data
  },
  async version(id: string, versionId: string): Promise<DocumentVersion> {
    const { data } = await http.get<DocumentVersion>(`/documents/${id}/versions/${versionId}`)
    return data
  },
  async chunks(
    id: string,
    versionId: string,
    page = 1,
    pageSize = 50,
  ): Promise<Paginated<Chunk>> {
    const { data } = await http.get<Paginated<Chunk>>(
      `/documents/${id}/versions/${versionId}/chunks`,
      { params: { page, pageSize } },
    )
    return data
  },
}
