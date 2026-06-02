/**
 * @koa/multer 不带类型声明，这里给出一期所需的最小 ambient 声明。
 * 注意：本文件须保持为「脚本」（无顶层 import/export），否则 declare module 会变成增强；
 * 同理不在此 augment 'koa'（会误把 koa 真实类型整体替换）。上传文件的类型在 controller 内局部标注。
 */
declare module '@koa/multer' {
  import type { Middleware } from 'koa'

  export interface MulterFile {
    fieldname: string
    originalname: string
    mimetype: string
    size: number
    buffer: Buffer
  }

  interface StorageEngine {
    readonly _brand?: 'storage'
  }

  interface Options {
    storage?: StorageEngine
    limits?: { fileSize?: number; files?: number }
  }

  interface Instance {
    single(field: string): Middleware
    any(): Middleware
    none(): Middleware
  }

  interface MulterFactory {
    (options?: Options): Instance
    memoryStorage(): StorageEngine
    diskStorage(opts: unknown): StorageEngine
  }

  const multer: MulterFactory
  export default multer
}
