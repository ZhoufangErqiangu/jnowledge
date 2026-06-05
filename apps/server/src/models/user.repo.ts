import { sql } from 'kysely'
import type { Selectable } from 'kysely'
import type { DB, UsersTable } from './schema.js'
import type { UserRole, UserStatus } from '@jnowledge/shared'

export type UserRow = Selectable<UsersTable>

export interface NewUser {
  id: string
  email: string
  passwordHash: string
  displayName?: string | null
  role?: UserRole
  status?: UserStatus
}

export function createUserRepo(db: DB) {
  return {
    async findById(id: string): Promise<UserRow | undefined> {
      return db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async findByEmail(email: string): Promise<UserRow | undefined> {
      return db
        .selectFrom('users')
        .selectAll()
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    },

    async insert(u: NewUser): Promise<UserRow> {
      return db
        .insertInto('users')
        .values({
          id: u.id,
          email: u.email,
          password_hash: u.passwordHash,
          display_name: u.displayName ?? null,
          ...(u.role ? { role: u.role } : {}),
          ...(u.status ? { status: u.status } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },

    async touch(id: string): Promise<void> {
      await db
        .updateTable('users')
        .set({ updated_at: sql`now()` })
        .where('id', '=', id)
        .execute()
    },
  }
}

export type UserRepo = ReturnType<typeof createUserRepo>
