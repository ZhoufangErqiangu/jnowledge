import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import Router from '@koa/router'
import swaggerUiDist from 'swagger-ui-dist'
import type { AppState } from './state.js'
import { buildOpenApiDocument } from './openapi.js'

const ASSET_DIR = swaggerUiDist.getAbsoluteFSPath()
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.html': 'text/html',
  '.map': 'application/json',
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <title>jnowledge API</title>
  <link rel="stylesheet" href="./docs-assets/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="./docs-assets/swagger-ui-bundle.js"></script>
  <script src="./docs-assets/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '../openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    })
  </script>
</body>
</html>`

/** 挂载 /openapi.json + /docs（Swagger UI）。文档从 zod 生成，每次请求实时构建。 */
export function createDocsRouter(): Router<AppState> {
  const router = new Router<AppState>()

  router.get('/openapi.json', (ctx) => {
    ctx.body = buildOpenApiDocument()
  })

  router.get('/docs', (ctx) => {
    ctx.type = 'text/html'
    ctx.body = INDEX_HTML
  })

  // 静态资源：仅放行 swagger-ui-dist 内的文件名（防目录穿越）
  router.get('/docs-assets/:file', async (ctx) => {
    const file = ctx.params.file!
    if (file.includes('/') || file.includes('..')) {
      ctx.status = 400
      return
    }
    try {
      const buf = await readFile(join(ASSET_DIR, file))
      ctx.type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream'
      ctx.body = buf
    } catch {
      ctx.status = 404
    }
  })

  return router
}
