import type {
  AddMemberRequest,
  Collection,
  CollectionMember,
  CollectionTreeNode,
  CreateCollectionRequest,
  UpdateCollectionRequest,
} from '@jnowledge/shared'
import { http } from './http'

export const collectionsApi = {
  async tree(): Promise<CollectionTreeNode[]> {
    const { data } = await http.get<CollectionTreeNode[]>('/collections/tree')
    return data
  },
  async get(id: string): Promise<Collection> {
    const { data } = await http.get<Collection>(`/collections/${id}`)
    return data
  },
  async create(req: CreateCollectionRequest): Promise<Collection> {
    const { data } = await http.post<Collection>('/collections', req)
    return data
  },
  async update(id: string, req: UpdateCollectionRequest): Promise<Collection> {
    const { data } = await http.patch<Collection>(`/collections/${id}`, req)
    return data
  },
  async remove(id: string): Promise<void> {
    await http.delete(`/collections/${id}`)
  },
  async members(id: string): Promise<CollectionMember[]> {
    const { data } = await http.get<CollectionMember[]>(`/collections/${id}/members`)
    return data
  },
  async addMember(id: string, req: AddMemberRequest): Promise<CollectionMember> {
    const { data } = await http.post<CollectionMember>(`/collections/${id}/members`, req)
    return data
  },
  async removeMember(id: string, userId: string): Promise<void> {
    await http.delete(`/collections/${id}/members/${userId}`)
  },
}
