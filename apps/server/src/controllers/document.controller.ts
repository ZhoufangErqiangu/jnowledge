import Router from '@koa/router'
import multer, { type MulterFile } from '@koa/multer'
import {
  createDocumentRequestSchema,
  paginationQuerySchema,
  updateDocumentRequestSchema,
} from '@jnowledge/shared'
import type { Container } from '../container.js'
import { type AppState, requirePrincipal } from '../http/state.js'
import { AppError } from '../errors.js'
import { ERROR_CODES } from '@jnowledge/shared'

// 内存存储：解析在异步 worker 里做，请求只需把 buffer 落对象存储。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
})

export function createDocumentController(c: Container): Router<AppState> {
  const router = new Router<AppState>()
  const { documents } = c.services

  router.use(c.requireAuth)

  // 手动新建文档
  router.post('/documents', async (ctx) => {
    const req = createDocumentRequestSchema.parse(ctx.request.body)
    ctx.status = 201
    ctx.body = await documents.createManual(requirePrincipal(ctx.state), req)
  })

  // 列出某知识库下的文档
  router.get('/collections/:collectionId/documents', async (ctx) => {
    const page = paginationQuerySchema.parse(ctx.query)
    ctx.body = await documents.listByCollection(
      requirePrincipal(ctx.state),
      ctx.params.collectionId!,
      page,
    )
  })

  // 上传文件（multipart/form-data，字段名 file）
  router.post(
    '/collections/:collectionId/documents/upload',
    upload.single('file'),
    async (ctx) => {
      // @koa/multer 把文件挂到 ctx.request.file（未提供 koa 类型增强，故局部标注）
      const file = (ctx.request as { file?: MulterFile }).file
      if (!file) throw new AppError(ERROR_CODES.VALIDATION, '缺少上传文件（字段名 file）')
      ctx.status = 201
      ctx.body = await documents.upload(requirePrincipal(ctx.state), ctx.params.collectionId!, {
        buffer: file.buffer,
        originalName: file.originalname,
        clientMime: file.mimetype,
      })
    },
  )

  // 文档详情
  router.get('/documents/:id', async (ctx) => {
    ctx.body = await documents.getDetail(requirePrincipal(ctx.state), ctx.params.id!)
  })

  // 编辑（改标题/正文，正文变更生成新版本并触发重分块）
  router.patch('/documents/:id', async (ctx) => {
    const req = updateDocumentRequestSchema.parse(ctx.request.body)
    ctx.body = await documents.update(requirePrincipal(ctx.state), ctx.params.id!, req)
  })

  // 删除（软删）
  router.delete('/documents/:id', async (ctx) => {
    await documents.remove(requirePrincipal(ctx.state), ctx.params.id!)
    ctx.status = 204
  })

  // 版本历史
  router.get('/documents/:id/versions', async (ctx) => {
    ctx.body = await documents.listVersions(requirePrincipal(ctx.state), ctx.params.id!)
  })

  // 某版本全文
  router.get('/documents/:id/versions/:versionId', async (ctx) => {
    ctx.body = await documents.getVersion(
      requirePrincipal(ctx.state),
      ctx.params.id!,
      ctx.params.versionId!,
    )
  })

  // 某版本的分块
  router.get('/documents/:id/versions/:versionId/chunks', async (ctx) => {
    const page = paginationQuerySchema.parse(ctx.query)
    ctx.body = await documents.listChunks(
      requirePrincipal(ctx.state),
      ctx.params.id!,
      ctx.params.versionId!,
      page,
    )
  })

  return router
}
