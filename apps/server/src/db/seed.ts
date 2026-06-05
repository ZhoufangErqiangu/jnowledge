import { hash as bcryptHash } from '@liuhlightning/bcrypt'
import { uuidv7 } from 'uuidv7'
import type { DB } from '../models/schema.js'

/** 固定引导管理员（数据库初始化时创建）。 */
export const BOOTSTRAP_ADMIN = {
  email: 'admin@admin.com',
  password: 'admin12345',
} as const

/**
 * 幂等创建引导管理员：已存在则跳过。
 * 在迁移到最新后调用，保证「初始化数据库时」即有一个可登录的 admin。
 */
export async function seedAdmin(db: DB, bcryptCost = 12): Promise<'created' | 'exists'> {
  const existing = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', BOOTSTRAP_ADMIN.email)
    .executeTakeFirst()
  if (existing) return 'exists'

  await db
    .insertInto('users')
    .values({
      id: uuidv7(),
      email: BOOTSTRAP_ADMIN.email,
      password_hash: bcryptHash(BOOTSTRAP_ADMIN.password, bcryptCost),
      display_name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    .execute()
  return 'created'
}
