import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { Config } from '../../config/index.js'

/**
 * 对象存储抽象（MinIO / S3 兼容）。库里只存 key，文件内容进对象存储。
 * 一期不暴露预签名 URL，下载经后端代理流式转发即可。
 */
export interface StorageService {
  readonly bucket: string
  /** 启动时幂等确保 bucket 存在（MinIO 首次运行无 bucket）。 */
  ensureBucket(): Promise<void>
  putObject(key: string, body: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
}

export function createStorageService(config: Config): StorageService {
  const s3 = new S3Client({
    region: config.storage.region,
    forcePathStyle: config.storage.forcePathStyle,
    ...(config.storage.endpoint ? { endpoint: config.storage.endpoint } : {}),
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  })
  const bucket = config.storage.bucket

  return {
    bucket,

    async ensureBucket() {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }))
      } catch {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: bucket }))
        } catch (err) {
          // 并发/已存在则忽略
          const name = err instanceof Error ? err.name : ''
          if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err
        }
      }
    },

    async putObject(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },

    async getObject(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const bytes = await res.Body?.transformToByteArray()
      if (!bytes) throw new Error(`对象不存在或为空: ${key}`)
      return Buffer.from(bytes)
    },

    async deleteObject(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
