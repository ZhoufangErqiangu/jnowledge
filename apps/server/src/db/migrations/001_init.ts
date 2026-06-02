import { type Kysely, sql } from 'kysely'

/**
 * 一期初始 schema：7 张表。
 * 主键 UUIDv7 由应用层生成（无需 DB 扩展）；时间戳 timestamptz + 软删除。
 * 易变属性进 jsonb。pgvector / AGE / tsv 生成列均为后续期次迁移，此处不建。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`

  // users
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('display_name', 'text')
    .addColumn('role', 'text', (c) => c.notNull().defaultTo('user'))
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  // email 在未软删用户中唯一
  await db.schema
    .createIndex('users_email_unique')
    .on('users')
    .column('email')
    .unique()
    .where(sql.ref('deleted_at'), 'is', null)
    .execute()

  // collections（自嵌套文件夹）
  await db.schema
    .createTable('collections')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('parent_id', 'uuid', (c) =>
      c.references('collections.id').onDelete('cascade'),
    )
    .addColumn('owner_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('description', 'text')
    .addColumn('settings', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('collections_parent_idx')
    .on('collections')
    .column('parent_id')
    .execute()
  await db.schema
    .createIndex('collections_owner_idx')
    .on('collections')
    .column('owner_id')
    .execute()

  // collection_members（ACL）
  await db.schema
    .createTable('collection_members')
    .addColumn('collection_id', 'uuid', (c) =>
      c.notNull().references('collections.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('collection_members_pk', ['collection_id', 'user_id'])
    .execute()

  await db.schema
    .createIndex('collection_members_user_idx')
    .on('collection_members')
    .column('user_id')
    .execute()

  // files（对象存储元数据）
  await db.schema
    .createTable('files')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('storage_bucket', 'text', (c) => c.notNull())
    .addColumn('storage_key', 'text', (c) => c.notNull())
    .addColumn('file_size', 'bigint', (c) => c.notNull())
    .addColumn('mime_type', 'text', (c) => c.notNull())
    .addColumn('checksum', 'text', (c) => c.notNull())
    .addColumn('original_name', 'text')
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  // 按 checksum 去重的查找索引（未软删）
  await db.schema
    .createIndex('files_checksum_idx')
    .on('files')
    .column('checksum')
    .where(sql.ref('deleted_at'), 'is', null)
    .execute()

  // documents
  await db.schema
    .createTable('documents')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('collection_id', 'uuid', (c) =>
      c.notNull().references('collections.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('source_type', 'text', (c) => c.notNull())
    .addColumn('current_version_id', 'uuid') // app 管理，避免与 versions 循环 FK
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('status_error', 'text')
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('documents_collection_idx')
    .on('documents')
    .column('collection_id')
    .execute()

  // document_versions（内容快照）
  await db.schema
    .createTable('document_versions')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('document_id', 'uuid', (c) =>
      c.notNull().references('documents.id').onDelete('cascade'),
    )
    .addColumn('version_no', 'integer', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    .addColumn('content_format', 'text', (c) => c.notNull().defaultTo('markdown'))
    .addColumn('checksum', 'text', (c) => c.notNull())
    .addColumn('source_file_id', 'uuid', (c) => c.references('files.id'))
    .addColumn('author_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('document_versions_no_unique', ['document_id', 'version_no'])
    .execute()

  await db.schema
    .createIndex('document_versions_document_idx')
    .on('document_versions')
    .column('document_id')
    .execute()

  // chunks（绑 document_version_id）
  await db.schema
    .createTable('chunks')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('document_version_id', 'uuid', (c) =>
      c.notNull().references('document_versions.id').onDelete('cascade'),
    )
    .addColumn('seq', 'integer', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    .addColumn('token_count', 'integer', (c) => c.notNull())
    .addColumn('char_start', 'integer', (c) => c.notNull())
    .addColumn('char_end', 'integer', (c) => c.notNull())
    .addColumn('heading_path', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('chunks_seq_unique', ['document_version_id', 'seq'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('chunks').ifExists().execute()
  await db.schema.dropTable('document_versions').ifExists().execute()
  await db.schema.dropTable('documents').ifExists().execute()
  await db.schema.dropTable('files').ifExists().execute()
  await db.schema.dropTable('collection_members').ifExists().execute()
  await db.schema.dropTable('collections').ifExists().execute()
  await db.schema.dropTable('users').ifExists().execute()
}
