import { sql } from 'kysely'
import type { Selectable } from 'kysely'
import type { CollectionsTable, DB } from './schema.js'
import type { CollectionSettings } from '@jnowledge/shared'

export type CollectionRow = Selectable<CollectionsTable>

export interface NewCollection {
  id: string
  name: string
  parentId?: string | null
  ownerId: string
  description?: string | null
  settings?: CollectionSettings
  createdBy: string
}

export interface CollectionPatch {
  name?: string
  parentId?: string | null
  description?: string | null
  settings?: CollectionSettings
}

export function createCollectionRepo(db: DB) {
  return {
    async findById(id: string): Promise<CollectionRow | undefined> {
      return db
        .selectFrom('collections')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async findByNameAndParent(
      ownerId: string,
      name: string,
      parentId: string | null,
      excludeId?: string,
    ): Promise<CollectionRow | undefined> {
      let q = db
        .selectFrom('collections')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('name', '=', name)
        .where('deleted_at', 'is', null)
      q = parentId
        ? q.where('parent_id', '=', parentId)
        : q.where('parent_id', 'is', null)
      if (excludeId) q = q.where('id', '!=', excludeId)
      return q.executeTakeFirst()
    },

    /** 用户可见的全部知识库（owner 或 member）。一期按平铺返回，树由 service 组装。 */
    async listForUser(userId: string): Promise<CollectionRow[]> {
      return db
        .selectFrom('collections')
        .selectAll('collections')
        .where('collections.deleted_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('collections.owner_id', '=', userId),
            eb.exists(
              eb
                .selectFrom('collection_members')
                .select('collection_members.user_id')
                .whereRef('collection_members.collection_id', '=', 'collections.id')
                .where('collection_members.user_id', '=', userId),
            ),
          ]),
        )
        .orderBy('collections.created_at', 'asc')
        .execute()
    },

    /** 未删除的直接子知识库数（写操作安全判级的确定性事实）。 */
    async countChildren(parentId: string): Promise<number> {
      const { count } = await db
        .selectFrom('collections')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('parent_id', '=', parentId)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow()
      return Number(count)
    },

    async insert(c: NewCollection): Promise<CollectionRow> {
      return db
        .insertInto('collections')
        .values({
          id: c.id,
          name: c.name,
          parent_id: c.parentId ?? null,
          owner_id: c.ownerId,
          description: c.description ?? null,
          ...(c.settings ? { settings: c.settings } : {}),
          created_by: c.createdBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async update(id: string, patch: CollectionPatch): Promise<CollectionRow | undefined> {
      const set: Record<string, unknown> = { updated_at: sql`now()` }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.parentId !== undefined) set.parent_id = patch.parentId
      if (patch.description !== undefined) set.description = patch.description
      if (patch.settings !== undefined) set.settings = patch.settings
      return db
        .updateTable('collections')
        .set(set)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst()
    },

    async softDelete(id: string): Promise<void> {
      await db
        .updateTable('collections')
        .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },
  }
}

export type CollectionRepo = ReturnType<typeof createCollectionRepo>
