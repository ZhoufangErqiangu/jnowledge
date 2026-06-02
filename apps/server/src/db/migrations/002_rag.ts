import { type Kysely, sql } from 'kysely'

/**
 * 二期 RAG schema：向量检索 + 中文全文检索 + 会话/消息。
 * 依赖自构建 PG 镜像（pgvector + zhparser 二进制已在镜像内）；此处只做 DB 层启用与建表。
 *
 * 顺序敏感：扩展 → chinese_zh 文本搜索配置 → chunks.tsv 生成列（引用该配置，要求其已存在）。
 * embedding 维度硬编码 1024（对应默认 EMBEDDING_MODEL=BAAI/bge-m3 / EMBEDDING_DIM）；换维度需新迁移。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`now()`

  // 1) 扩展（需超级用户；docker 的 jnowledge 用户即超级用户）
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db)
  await sql`CREATE EXTENSION IF NOT EXISTS zhparser`.execute(db)

  // 2) 中文文本搜索配置：zhparser 分词 + 把有意义的词性映射到 simple 词典。
  //    排除标点(w)/助词(u)/语气词(y)/连词(c)/介词(p)等纯功能词，保留实词与数量/时间/英文等。
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese_zh') THEN
        CREATE TEXT SEARCH CONFIGURATION chinese_zh (PARSER = zhparser);
        ALTER TEXT SEARCH CONFIGURATION chinese_zh
          ADD MAPPING FOR a,b,d,e,f,i,j,l,m,n,q,r,s,t,v,z WITH simple;
      END IF;
    END
    $$;
  `.execute(db)

  // 3) chunk_embeddings：每 chunk × model 一条向量。HNSW + cosine。
  await db.schema
    .createTable('chunk_embeddings')
    .addColumn('chunk_id', 'uuid', (c) =>
      c.notNull().references('chunks.id').onDelete('cascade'),
    )
    .addColumn('model', 'text', (c) => c.notNull())
    .addColumn('dim', 'integer', (c) => c.notNull())
    .addColumn('embedding', sql`vector(1024)`, (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('chunk_embeddings_pk', ['chunk_id', 'model'])
    .execute()

  // HNSW 近邻索引（cosine）。建索引耗时随数据量增长，存量小先建。
  await sql`
    CREATE INDEX chunk_embeddings_hnsw
      ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
  `.execute(db)

  // 4) chunks.tsv 生成列 + GIN。to_tsvector(常量配置, text) 为 IMMUTABLE，可用于生成列。
  await sql`
    ALTER TABLE chunks
      ADD COLUMN tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('chinese_zh', content)) STORED
  `.execute(db)
  await sql`CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv)`.execute(db)

  // 5) conversations（会话，绑 collection；ACL 复用 collection 成员关系）
  await db.schema
    .createTable('conversations')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('collection_id', 'uuid', (c) =>
      c.notNull().references('collections.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('created_by', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('deleted_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('conversations_collection_idx')
    .on('conversations')
    .columns(['collection_id', 'created_by'])
    .execute()

  // 6) messages（消息；assistant 消息的 citations 落引用的 chunk 列表）
  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('conversation_id', 'uuid', (c) =>
      c.notNull().references('conversations.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (c) => c.notNull())
    .addColumn('content', 'text', (c) => c.notNull())
    /** 引用：[{ chunkId, documentId, versionId, seq, headingPath, charStart, charEnd, snippet }] */
    .addColumn('citations', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute()

  await db.schema
    .createIndex('messages_conversation_idx')
    .on('messages')
    .columns(['conversation_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('messages').ifExists().execute()
  await db.schema.dropTable('conversations').ifExists().execute()
  await sql`DROP INDEX IF EXISTS chunks_tsv_gin`.execute(db)
  await sql`ALTER TABLE chunks DROP COLUMN IF EXISTS tsv`.execute(db)
  await db.schema.dropTable('chunk_embeddings').ifExists().execute()
  await sql`DROP TEXT SEARCH CONFIGURATION IF EXISTS chinese_zh`.execute(db)
  // 扩展不删：可能被其他对象依赖，且重复 up 已 IF NOT EXISTS。
}
