import type { Scope, ToolResult } from './types.js'

/**
 * 作用域 = 沿 run 树委派的能力（capability delegation）。
 *
 * 规则在每个节点都一样：调用方发给你一个天花板；你可在天花板内自由选择/收窄，
 * 但永不能自己加宽；够不着的（超天花板）显式回报给调用方。
 * - 顶层 agent 的天花板恒为 'principal'（人把自己的全量访问权交给它），实权仍由 assertRole 守。
 * - 数组天花板（硬收窄）只可能经 agentAsTool 委派产生（narrow）。
 *
 * 安全不变式：LLM/system prompt 不是边界——边界是 assertRole(principal) + 这里的成员校验。
 * 即便父 agent 被注入、给子 agent 委派超出自身的库，narrow 的交集也会把它挡回。
 */

/** 目标库是否在天花板内。principal 恒真（实权由 assertRole 守）；数组判成员。 */
export function inCeiling(scope: Scope, collectionId: string): boolean {
  return scope.ceiling === 'principal' || scope.ceiling.includes(collectionId)
}

/**
 * 委派收窄（agentAsTool 用）：子 = 父 ∩ 请求，只能收窄、不能加宽。
 * - 请求省略 → 子继承父天花板（不加宽）。
 * - 父 principal → 子取请求集（父允许一切，故委派即请求；实际可达仍受 assertRole 兜底）。
 * - 父数组 → 子取交集（请求里超出父的库被丢弃）。
 */
export function narrow(parent: Scope, requested?: string[]): Scope {
  if (requested === undefined) return { ceiling: parent.ceiling }
  if (parent.ceiling === 'principal') return { ceiling: [...requested] }
  const allowed = new Set(parent.ceiling)
  return { ceiling: requested.filter((c) => allowed.has(c)) }
}

/** 统一越界回执：留痕"请求了什么、允许什么"，要求显式上报而非绕过。 */
export function outOfScope(requested: string, allowed: Scope): ToolResult {
  const scopeDesc = allowed.ceiling === 'principal' ? '（principal 全量）' : allowed.ceiling.join(', ')
  return {
    ok: false,
    output: `知识库 ${requested} 超出当前作用域，无法操作。当前允许范围：${scopeDesc}。如确需，请如实回报调用方/用户，不要尝试绕过。`,
    summary: `out_of_scope：${requested}`,
    error: 'out_of_scope',
  }
}
