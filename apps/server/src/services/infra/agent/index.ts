/**
 * Agent Runtime（infra）：通用 ReAct 循环 + 工具框架。是纯机制——
 * 工具的注册与具体能力的接线由 domain/agent.service 用其依赖（retrieval/models）完成，
 * 避免 infra 反向依赖 domain。
 */
export * from './types.js'
export { Agent, type AgentConfig } from './agent.js'
export { createToolRegistry, toToolSpec } from './registry.js'
export { agentAsTool } from './agentAsTool.js'
export { createRunRecorder, type RunRecorder } from './runRecorder.js'
export { inCeiling, narrow, outOfScope } from './scope.js'
export { createKnowledgeSearchTool } from './tools/knowledgeSearch.js'
export { createGetDocumentTool } from './tools/getDocument.js'
export { createListCollectionsTool } from './tools/listCollections.js'
export { createMutationTools } from './tools/mutations.js'
export {
  createOperationAuditor,
  type OperationAuditor,
  type AuditVerdict,
} from './operationAuditor.js'
export { createRelevanceFilter, type RelevanceFilter } from './relevanceFilter.js'
export { assembleSystemPrompt, buildScopeSuffix, type SystemFacts } from './systemPrompt.js'
export {
  type ContextItemView,
  toContextItemView,
  projectForLlm,
  projectForChat,
  projectForUser,
} from './projection.js'
