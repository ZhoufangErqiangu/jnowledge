import type { Config } from './config/index.js'
import { createLogger, type Logger } from './logger.js'
import { createDb, type DB } from './db/index.js'
import { createModels, type Models } from './models/index.js'
import { createInfra, type Infra } from './services/infra/index.js'
import { createAuthService, type AuthService } from './services/domain/auth.service.js'
import {
  createCollectionService,
  type CollectionService,
} from './services/domain/collection.service.js'
import { createDocumentService, type DocumentService } from './services/domain/document.service.js'
import { createIngestionService, type IngestionService } from './services/domain/ingestion/index.js'
import { createRetrievalService, type RetrievalService } from './services/domain/retrieval.js'
import { createChatService, type ChatService } from './services/domain/chat.service.js'
import { createAgentService, type AgentService } from './services/domain/agent.service.js'
import { requireAuth } from './middleware/auth.js'
import type { AppMiddleware } from './http/state.js'

export interface Services {
  auth: AuthService
  collections: CollectionService
  documents: DocumentService
  ingestion: IngestionService
  retrieval: RetrievalService
  chat: ChatService
  agent: AgentService
}

export interface Container {
  config: Config
  logger: Logger
  db: DB
  models: Models
  infra: Infra
  services: Services
  /** 预绑定的鉴权中间件，controller 直接挂。 */
  requireAuth: AppMiddleware
}

/**
 * 组合根：显式实例化并接线所有单例（无 DI 框架/反射）。
 * 依赖顺序：config → logger → db → models → infra → domain services。
 */
export function buildContainer(config: Config): Container {
  const logger = createLogger(config)
  const db = createDb(config)
  const models = createModels(db)
  const infra = createInfra(config, logger, db)

  const auth = createAuthService({ config, users: models.users })
  const collections = createCollectionService({
    collections: models.collections,
    members: models.collectionMembers,
    users: models.users,
  })
  const documents = createDocumentService({
    db,
    models,
    infra,
    collectionService: collections,
  })
  const ingestion = createIngestionService({ config, db, models, infra, logger })
  const retrieval = createRetrievalService({ config, models, infra, logger })
  const chat = createChatService({
    models,
    infra,
    logger,
    collectionService: collections,
    retrieval,
  })
  const agent = createAgentService({
    models,
    infra,
    logger,
    collectionService: collections,
    documentService: documents,
    retrieval,
  })

  return {
    config,
    logger,
    db,
    models,
    infra,
    services: { auth, collections, documents, ingestion, retrieval, chat, agent },
    requireAuth: requireAuth(auth),
  }
}
