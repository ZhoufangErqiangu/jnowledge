/**
 * Agent Runtime（infra 纯机制）：通用 ReAct 运行循环 + 工具/作用域契约。
 * 只含「运行 agent」所需的机制——不依赖 models / domain。
 *
 * 调用方编排（上下文投影 projection、事件落库 runRecorder、system prompt 组装、
 * 具体工具实现 tools/、agent-as-tool 委派）已上移到 `services/domain/agent/`：
 * 那些依赖 models / domain service，属调用方职责，避免 infra 反向依赖。
 */
export * from './types.js'
export { Agent, type AgentConfig } from './agent.js'
export { createToolRegistry, toToolSpec } from './registry.js'
export { inCeiling, narrow, outOfScope } from './scope.js'
