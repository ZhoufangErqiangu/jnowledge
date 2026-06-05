import type { Selectable } from 'kysely'
import type { CollectionMembersTable, DB, UsersTable } from './schema.js'
import type { CollectionRole } from '@jnowledge/shared'

export type CollectionMemberRow = Selectable<CollectionMembersTable>
export type MemberWithUserRow = CollectionMemberRow & {
  user: Selectable<UsersTable>
}

export function createCollectionMemberRepo(db: DB) {
  return {
    async find(collectionId: string, userId: string): Promise<CollectionMemberRow | undefined> {
      return db
        .selectFrom('collection_members')
        .selectAll()
        .where('collection_id', '=', collectionId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
    },

    async listWithUsers(collectionId: string): Promise<MemberWithUserRow[]> {
      const rows = await db
        .selectFrom('collection_members as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .selectAll('m')
        .select((eb) => [
          eb.ref('u.id').as('u_id'),
          eb.ref('u.email').as('u_email'),
          eb.ref('u.display_name').as('u_display_name'),
          eb.ref('u.role').as('u_role'),
          eb.ref('u.status').as('u_status'),
          eb.ref('u.password_hash').as('u_password_hash'),
          eb.ref('u.created_at').as('u_created_at'),
          eb.ref('u.updated_at').as('u_updated_at'),
          eb.ref('u.deleted_at').as('u_deleted_at'),
        ])
        .where('m.collection_id', '=', collectionId)
        .where('u.deleted_at', 'is', null)
        .orderBy('m.created_at', 'asc')
        .execute()

      return rows.map((r) => ({
        collection_id: r.collection_id,
        user_id: r.user_id,
        role: r.role,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        user: {
          id: r.u_id,
          email: r.u_email,
          display_name: r.u_display_name,
          role: r.u_role,
          status: r.u_status,
          password_hash: r.u_password_hash,
          created_at: r.u_created_at,
          updated_at: r.u_updated_at,
          deleted_at: r.u_deleted_at,
        },
      }))
    },

    async upsert(
      collectionId: string,
      userId: string,
      role: CollectionRole,
      createdBy: string,
    ): Promise<void> {
      await db
        .insertInto('collection_members')
        .values({
          collection_id: collectionId,
          user_id: userId,
          role,
          created_by: createdBy,
        })
        .onConflict((oc) => oc.columns(['collection_id', 'user_id']).doUpdateSet({ role }))
        .execute()
    },

    async remove(collectionId: string, userId: string): Promise<void> {
      await db
        .deleteFrom('collection_members')
        .where('collection_id', '=', collectionId)
        .where('user_id', '=', userId)
        .execute()
    },
  }
}

export type CollectionMemberRepo = ReturnType<typeof createCollectionMemberRepo>
