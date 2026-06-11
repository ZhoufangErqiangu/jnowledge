import { type Kysely } from 'kysely'
import { hash as bcryptHash } from '@liuhlightning/bcrypt'
import { uuidv7 } from 'uuidv7'

const BOOTSTRAP_EMAIL = 'admin@admin.com'
const BOOTSTRAP_PASSWORD = 'admin12345'

export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>
  const existing = await d.selectFrom('users').select('id').where('email', '=', BOOTSTRAP_EMAIL).executeTakeFirst()
  if (existing) return

  await d
    .insertInto('users')
    .values({
      id: uuidv7(),
      email: BOOTSTRAP_EMAIL,
      password_hash: bcryptHash(BOOTSTRAP_PASSWORD, 12),
      display_name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<any>).deleteFrom('users').where('email', '=', BOOTSTRAP_EMAIL).execute()
}
