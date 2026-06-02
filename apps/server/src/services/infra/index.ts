import type { Config } from '../../config/index.js'
import type { Logger } from '../../logger.js'
import { createStorageService } from './storage.js'
import { createJobQueue } from './jobs.js'
import { createLLMClient } from './llm/index.js'
import { createNullVectorStore } from './vectorStore.js'
import { createNullGraphStore } from './graphStore.js'

/** 组合根用：实例化全部基础设施 service。 */
export function createInfra(config: Config, logger: Logger) {
  return {
    storage: createStorageService(config),
    jobs: createJobQueue(config, logger),
    llm: createLLMClient(config),
    vectorStore: createNullVectorStore(),
    graphStore: createNullGraphStore(),
  }
}

export type Infra = ReturnType<typeof createInfra>

export * from './storage.js'
export * from './jobs.js'
export * from './vectorStore.js'
export * from './graphStore.js'
