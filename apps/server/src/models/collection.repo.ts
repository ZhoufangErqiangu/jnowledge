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
