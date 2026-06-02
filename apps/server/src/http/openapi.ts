import { z } from 'zod'
import type { OpenAPIV3_1 } from 'openapi-types'
import {
  addMemberRequestSchema,
  authResponseSchema,
  chunkSchema,
  collectionSchema,
  collectionMemberSchema,
  createCollectionRequestSchema,
  createDocumentRequestSchema,
  documentSchema,
  documentDetailSchema,
  documentVersionSchema,
  documentVersionSummarySchema,
  errorResponseSchema,
  loginRequestSchema,
  publicUserSchema,
  registerRequestSchema,
  updateCollectionRequestSchema,
  updateDocumentRequestSchema,
} from '@jnowledge/shared'

/**
 * OpenAPI 文档「从 zod 生成」（路线 A）：components.schemas 由 zod 单一真相源转出，
 * 仅作人读文档 + Swagger UI；前端不走 OpenAPI codegen，直接 import shared 类型。
 */
const SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  ErrorResponse: errorResponseSchema,
  RegisterRequest: registerRequestSchema,
  LoginRequest: loginRequestSchema,
  AuthResponse: authResponseSchema,
  PublicUser: publicUserSchema,
  CreateCollectionRequest: createCollectionRequestSchema,
  UpdateCollectionRequest: updateCollectionRequestSchema,
  Collection: collectionSchema,
  CollectionMember: collectionMemberSchema,
  AddMemberRequest: addMemberRequestSchema,
  CreateDocumentRequest: createDocumentRequestSchema,
  UpdateDocumentRequest: updateDocumentRequestSchema,
  Document: documentSchema,
  DocumentDetail: documentDetailSchema,
  DocumentVersion: documentVersionSchema,
  DocumentVersionSummary: documentVersionSummarySchema,
  Chunk: chunkSchema,
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const jsonBody = (name: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
})
const jsonResp = (name: string, description = 'OK') => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
})
const errResp = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorResponse') } },
})

const bearer = [{ bearerAuth: [] }]

export function buildOpenApiDocument(): OpenAPIV3_1.Document {
  const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {}
  for (const [name, schema] of Object.entries(SCHEMA_REGISTRY)) {
    schemas[name] = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'output',
    }) as OpenAPIV3_1.SchemaObject
  }

  return {
    openapi: '3.1.0',
    info: { title: 'jnowledge API', version: '0.0.0', description: '知识库系统一期 API' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas,
    },
    paths: {
      '/auth/register': {
        post: {
          tags: ['auth'],
          summary: '注册',
          requestBody: jsonBody('RegisterRequest'),
          responses: { '201': jsonResp('AuthResponse', '已创建'), '409': errResp('邮箱已注册') },
        },
      },
      '/auth/login': {
        post: {
          tags: ['auth'],
          summary: '登录',
          requestBody: jsonBody('LoginRequest'),
          responses: { '200': jsonResp('AuthResponse'), '401': errResp('凭据无效') },
        },
      },
      '/auth/me': {
        get: {
          tags: ['auth'],
          summary: '当前用户',
          security: bearer,
          responses: { '200': jsonResp('PublicUser') },
        },
      },
      '/collections': {
        post: {
          tags: ['collection'],
          summary: '新建知识库',
          security: bearer,
          requestBody: jsonBody('CreateCollectionRequest'),
          responses: { '201': jsonResp('Collection', '已创建') },
        },
      },
      '/collections/tree': {
        get: {
          tags: ['collection'],
          summary: '文件夹树',
          security: bearer,
          responses: { '200': { description: '知识库树（嵌套 Collection）' } },
        },
      },
      '/collections/{id}': {
        get: {
          tags: ['collection'],
          summary: '详情',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '200': jsonResp('Collection'), '404': errResp('不存在') },
        },
        patch: {
          tags: ['collection'],
          summary: '更新',
          security: bearer,
          parameters: [pathParam('id')],
          requestBody: jsonBody('UpdateCollectionRequest'),
          responses: { '200': jsonResp('Collection') },
        },
        delete: {
          tags: ['collection'],
          summary: '删除',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '204': { description: '已删除' } },
        },
      },
      '/collections/{id}/members': {
        get: {
          tags: ['collection'],
          summary: '成员列表',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '200': { description: 'CollectionMember[]' } },
        },
        post: {
          tags: ['collection'],
          summary: '添加成员',
          security: bearer,
          parameters: [pathParam('id')],
          requestBody: jsonBody('AddMemberRequest'),
          responses: { '201': jsonResp('CollectionMember', '已添加') },
        },
      },
      '/documents': {
        post: {
          tags: ['document'],
          summary: '手动新建文档',
          security: bearer,
          requestBody: jsonBody('CreateDocumentRequest'),
          responses: { '201': jsonResp('Document', '已创建') },
        },
      },
      '/collections/{collectionId}/documents': {
        get: {
          tags: ['document'],
          summary: '列出文档',
          security: bearer,
          parameters: [pathParam('collectionId')],
          responses: { '200': { description: '分页 Document 列表' } },
        },
      },
      '/collections/{collectionId}/documents/upload': {
        post: {
          tags: ['document'],
          summary: '上传文件',
          security: bearer,
          parameters: [pathParam('collectionId')],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' } },
                  required: ['file'],
                },
              },
            },
          },
          responses: { '201': jsonResp('Document', '已受理，异步解析中') },
        },
      },
      '/documents/{id}': {
        get: {
          tags: ['document'],
          summary: '文档详情',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '200': jsonResp('DocumentDetail') },
        },
        patch: {
          tags: ['document'],
          summary: '编辑文档',
          security: bearer,
          parameters: [pathParam('id')],
          requestBody: jsonBody('UpdateDocumentRequest'),
          responses: { '200': jsonResp('Document') },
        },
        delete: {
          tags: ['document'],
          summary: '删除文档',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '204': { description: '已删除' } },
        },
      },
      '/documents/{id}/versions': {
        get: {
          tags: ['document'],
          summary: '版本历史',
          security: bearer,
          parameters: [pathParam('id')],
          responses: { '200': { description: 'DocumentVersionSummary[]' } },
        },
      },
      '/documents/{id}/versions/{versionId}': {
        get: {
          tags: ['document'],
          summary: '版本全文',
          security: bearer,
          parameters: [pathParam('id'), pathParam('versionId')],
          responses: { '200': jsonResp('DocumentVersion') },
        },
      },
      '/documents/{id}/versions/{versionId}/chunks': {
        get: {
          tags: ['document'],
          summary: '版本分块',
          security: bearer,
          parameters: [pathParam('id'), pathParam('versionId')],
          responses: { '200': { description: '分页 Chunk 列表' } },
        },
      },
    },
  }
}

function pathParam(name: string) {
  return { name, in: 'path' as const, required: true, schema: { type: 'string' as const } }
}
