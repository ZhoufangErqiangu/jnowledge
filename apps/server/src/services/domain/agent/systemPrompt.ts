/**
 * 动态 system prompt 组装（五期 §14.5 / DESIGN §8.2）。
 *
 * 真相源原则的推论：system 内容**不整体入库由代码重算**，而是发送即随轮快照（assembler/模板
 * 是会迭代的代码，重算会随版本漂移）。assembler 在请求时**生产**内容，产物一经发送即被快照为
 * 不可变事实，审计读快照、不再调 assembler。
 *
 * 按「作用域易变性」分两路放置，以保 DeepSeek 上下文缓存命中（实测：易变片段在前缀中间会让
 * 整段历史缓存全废 hit=0；放历史之后的后缀则 ~93% 命中）：
 * - **前缀**（`assembleSystemPrompt`，置于消息序最前、长期可缓存）：稳定模板 +（仅子 agent）
 *   **固定**作用域约束——子 agent 的 ceiling 在子 agent 构造时锁死、整个 run 不变，属稳定前缀。
 * - **后缀**（`buildScopeSuffix`，独立 system 消息，置于历史之后、贴最新 user 轮）：顶层 agent 的
 *   **易变**可访问库列表——跨轮可由用户收窄，放后缀使其变化只让小尾部失效、不动历史前缀。
 *
 * 当前 facts 仅含确定性上下文（本 run 的作用域天花板 + 可访问库快照）——意图理解的独立推理已被
 * 推翻（DESIGN §8.1），故暂无 LLM 派生输入。`facts` 是扩展点：将来若引入「意图摘要」等 LLM 产出，
 * 须先把那份产出落 context_item，再作为 fact 传入（assembler 只拼接已落库/确定性事实）。
 */

/** 注入 system prompt 的可访问库上限：超过则不逐条列出（避免 prompt 膨胀），退回 list_collections。 */
const MAX_LISTED_COLLECTIONS = 30

export interface SystemFacts {
  /**
   * 本 run 的作用域天花板（呈现用，携库名）：
   * - 'principal'：可跨库（顶层 agent 恒为此）；
   * - {id,title}[]：被委派收窄到指定库集（仅子 agent；dormant）。
   * 注意：这里携 title 供 prompt 措辞用，与 RunContext.scope（携 id 供运行时强制）区分。
   */
  scope: { ceiling: 'principal' | { id: string; title: string }[] }
  /**
   * principal 作用域下当前可访问的知识库（id + 名称）。注入后模型直接用 id 检索、通常无需再调
   * list_collections——尤其追问轮（工具结果跨轮回放仍可能被预算裁掉时）不再臆造 id。确定性事实
   * （listAccessible 快照）。**仅用于后缀**（顶层 principal 易变）；子 agent 固定作用域走前缀。
   */
  availableCollections?: { id: string; name: string }[]
}

/** 子 agent 固定作用域约束（前缀；ceiling 锁死整个 run → 稳定前缀，且语义上是不可逾越的硬边界）。 */
function fixedScopeConstraint(ceiling: { id: string; title: string }[]): string {
  const libs = ceiling.map((c) => `《${c.title}》`).join('') || '（空）'
  return `当前作用域被限定在以下知识库内：${libs}。超出此范围的需求无法触达，须如实回报调用方，不要尝试绕过。`
}

/**
 * 组装 system **前缀**（消息序最前、长期可缓存）：稳定模板 +（仅子 agent）固定作用域约束。
 * 顶层 agent（principal）的可访问库列表是跨轮易变内容，**不进前缀** —— 见 `buildScopeSuffix`。
 * 纯函数，相同入参恒产相同输出。
 */
export function assembleSystemPrompt(stableTemplate: string, facts: SystemFacts): string {
  const { ceiling } = facts.scope
  if (ceiling === 'principal') return stableTemplate
  return `${stableTemplate}\n\n${fixedScopeConstraint(ceiling)}`
}

/**
 * 构建易变作用域**后缀**（顶层 agent）：作为独立 system 消息插在历史之后、最新 user 轮之前。
 * 放后缀 → 可访问库变化只让小尾部缓存失效，保住「稳定 system + 历史」前缀缓存。
 * 返回 null 表示无需后缀（子 agent 的固定作用域已在前缀，不走此路）。纯函数。
 */
export function buildScopeSuffix(facts: SystemFacts): string | null {
  const { ceiling } = facts.scope
  if (ceiling !== 'principal') return null
  const cols = facts.availableCollections
  if (cols && cols.length > 0 && cols.length <= MAX_LISTED_COLLECTIONS) {
    const listed = cols.map((c) => `- ${c.id} :: ${c.name}`).join('\n')
    return [
      '当前作用域：可访问你权限范围内的全部知识库。以下是当前可访问的知识库（id :: 名称），',
      '可直接用对应 id 调用 knowledge_search 检索，通常无需再调 list_collections；',
      '切勿臆造 id——若此列表为空或你怀疑已过期，再调 list_collections 复核。',
      listed,
    ].join('\n')
  }
  if (cols && cols.length === 0) {
    return '当前作用域：你当前没有任何可访问的知识库；需要库内检索时请如实说明无可用资料。'
  }
  return '当前作用域：可访问你权限范围内的全部知识库；需要选库时用 list_collections 查看再以其 id 检索。'
}
