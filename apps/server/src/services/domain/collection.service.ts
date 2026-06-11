import { uuidv7 } from 'uuidv7'
import {
  COLLECTION_ROLE_RANK,
  ERROR_CODES,
  type AddMemberRequest,
  type Collection,
  type CollectionMember,
  type CollectionRole,
  type CollectionTreeNode,
  type CreateCollectionRequest,
  type UpdateCollectionRequest,
} from '@jnowledge/shared'
import type { CollectionRepo, CollectionRow } from '../../models/collection.repo.js'
import type { CollectionMemberRepo } from '../../models/collectionMember.repo.js'
import type { UserRepo } from '../../models/user.repo.js'
import { toCollection, toCollectionMember } from '../../models/mappers.js'
import { AppError } from '../../errors.js'

/** 请求者身份（来自 JWT），授权判定用。 */
export interface Principal {
  uid: string
  role: 'admin' | 'user'
}

export interface CollectionDeps {
  collections: CollectionRepo
  members: CollectionMemberRepo
  users: UserRepo
}

export interface CollectionService {
  create(p: Principal, req: CreateCollectionRequest): Promise<Collection>
  update(p: Principal, id: string, req: UpdateCollectionRequest): Promise<Collection>
  remove(p: Principal, id: string): Promise<void>
  getTree(p: Principal): Promise<CollectionTreeNode[]>
  /** 请求者可访问的全部知识库（扁平列表，全局 agent 选库用）。 */
  listAccessible(p: Principal): Promise<Collection[]>
  getById(p: Principal, id: string): Promise<Collection>
  /** 授权核心：要求请求者在该 collection 至少具备 minRole；否则抛 403/404。 */
  assertRole(p: Principal, id: string, minRole: CollectionRole): Promise<CollectionRow>
  listMembers(p: Principal, id: string): Promise<CollectionMember[]>
  addMember(p: Principal, id: string, req: AddMemberRequest): Promise<CollectionMember>
  removeMember(p: Principal, id: string, userId: string): Promise<void>
}

export function createCollectionService(deps: CollectionDeps): CollectionService {
  const { collections, members, users } = deps

  /** 计算请求者在某 collection 的有效角色（admin 与 owner 等同放行）。 */
  async function effectiveRole(
    p: Principal,
    row: CollectionRow,
  ): Promise<CollectionRole | undefined> {
    if (p.role === 'admin' || row.owner_id === p.uid) return 'owner'
    const m = await members.find(row.id, p.uid)
    return m?.role
  }

  async function assertRole(p: Principal, id: string, minRole: CollectionRole) {
    const row = await collections.findById(id)
    if (!row) throw new AppError(ERROR_CODES.COLLECTION_NOT_FOUND, '知识库不存在')
    const role = await effectiveRole(p, row)
    if (!role || COLLECTION_ROLE_RANK[role] < COLLECTION_ROLE_RANK[minRole]) {
      throw new AppError(ERROR_CODES.FORBIDDEN, '无权访问该知识库')
    }
    return row
  }

  return {
    assertRole,

    async create(p, req) {
      // 若指定父节点，需对父节点有 editor 权限
      if (req.parentId) await assertRole(p, req.parentId, 'editor')
      const dup = await collections.findByNameAndParent(p.uid, req.name, req.parentId ?? null)
      if (dup) throw new AppError(ERROR_CODES.CONFLICT, '同级知识库下已存在同名知识库')
      const row = await collections.insert({
        id: uuidv7(),
        name: req.name,
        parentId: req.parentId ?? null,
        ownerId: p.uid,
        description: req.description ?? null,
        ...(req.settings ? { settings: req.settings } : {}),
        createdBy: p.uid,
      })
      // owner 落一条成员记录，便于统一按 members 查询
      await members.upsert(row.id, p.uid, 'owner', p.uid)
      return toCollection(row)
    },

    async update(p, id, req) {
      const existing = await assertRole(p, id, 'editor')
      if (req.parentId) await assertRole(p, req.parentId, 'editor')
      if (req.name !== undefined) {
        const parentId = req.parentId !== undefined ? req.parentId : existing.parent_id
        const dup = await collections.findByNameAndParent(existing.owner_id, req.name, parentId, id)
        if (dup) throw new AppError(ERROR_CODES.CONFLICT, '同级知识库下已存在同名知识库')
      }
      const patch: Parameters<CollectionRepo['update']>[1] = {}
      if (req.name !== undefined) patch.name = req.name
      if (req.parentId !== undefined) patch.parentId = req.parentId
      if (req.description !== undefined) patch.description = req.description
      if (req.settings !== undefined) patch.settings = req.settings
      const row = await collections.update(id, patch)
      if (!row) throw new AppError(ERROR_CODES.COLLECTION_NOT_FOUND, '知识库不存在')
      return toCollection(row)
    },

    async remove(p, id) {
      await assertRole(p, id, 'owner')
      await collections.softDelete(id)
    },

    async getById(p, id) {
      const row = await assertRole(p, id, 'viewer')
      return toCollection(row)
    },

    async listAccessible(p) {
      const rows = await collections.listForUser(p.uid)
      return rows.map(toCollection)
    },

    async getTree(p) {
      const rows =
        p.role === 'admin'
          ? await collections.listForUser(p.uid) // admin 仍按其可见集合；全局视图二期再说
          : await collections.listForUser(p.uid)
      const nodes = new Map<string, CollectionTreeNode>()
      for (const r of rows) nodes.set(r.id, { ...toCollection(r), children: [] })
      const roots: CollectionTreeNode[] = []
      for (const node of nodes.values()) {
        const parent = node.parentId ? nodes.get(node.parentId) : undefined
        if (parent) parent.children.push(node)
        else roots.push(node)
      }
      return roots
    },

    async listMembers(p, id) {
      await assertRole(p, id, 'viewer')
      const rows = await members.listWithUsers(id)
      return rows.map(toCollectionMember)
    },

    async addMember(p, id, req) {
      await assertRole(p, id, 'owner')
      const target = await users.findById(req.userId)
      if (!target) throw new AppError(ERROR_CODES.NOT_FOUND, '目标用户不存在')
      await members.upsert(id, req.userId, req.role, p.uid)
      const rows = await members.listWithUsers(id)
      const row = rows.find((r) => r.user_id === req.userId)
      if (!row) throw new AppError(ERROR_CODES.INTERNAL, '成员写入后未找到')
      return toCollectionMember(row)
    },

    async removeMember(p, id, userId) {
      const row = await assertRole(p, id, 'owner')
      if (row.owner_id === userId) {
        throw new AppError(ERROR_CODES.CONFLICT, '不能移除知识库所有者')
      }
      await members.remove(id, userId)
    },
  }
}
