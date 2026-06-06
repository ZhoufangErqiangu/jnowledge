/**
 * 动态 system prompt 组装（五期 §14.5 / DESIGN §8.2）。
 *
 * 真相源原则的推论：system prompt **不整体入库**，而是 `(静态模板 + 已落库事实)` 的纯函数。
 * assembler 为纯函数 → 任意历史轮的实际 system 都可由 debug 页跑同一函数忠实重建，
 * 无需把整段 prompt 存死（且避免给"未来会变的动态片段"绑死建模）。
 *
 * 当前 facts 仅含确定性上下文（本 run 的作用域天花板）——意图理解的独立推理已被推翻
 * （DESIGN §8.1），故暂无 LLM 派生输入。`facts` 是扩展点：将来若引入"意图摘要"等 LLM 产出，
 * 须先把那份产出落 context_item，再作为 fact 传入此处（assembler 只拼接已落库事实 →
 * 确定性与可观测性同时成立）。
 *
 * 缓存友好：稳定模板前置、动态片段后置（保 DeepSeek 上下文缓存命中）。
 */

export interface SystemFacts {
  /**
   * 本 run 的作用域天花板（呈现用，携库名）：
   * - 'principal'：可跨库（顶层 agent 恒为此）；
   * - {id,title}[]：被委派收窄到指定库集（仅子 agent；dormant）。
   * 注意：这里携 title 供 prompt 措辞用，与 RunContext.scope（携 id 供运行时强制）区分。
   */
  scope: { ceiling: 'principal' | { id: string; title: string }[] }
}

/** RAG 生成（chat.service）的稳定模板（原 GENERATION_SYSTEM）。 */
export const RAG_GENERATION_TEMPLATE = [
  '你是知识库问答助手。只能依据下面提供的「资料」回答用户问题，不得编造资料外的信息。',
  '每条资料以 [序号] 开头。回答时，凡是引用了某条资料的句子，必须在句末用对应的 [序号] 标注来源（可多个，如 [1][3]）。',
  '若资料不足以回答，明确说明「根据现有资料无法回答」，不要臆测。用简洁的中文回答。',
].join('\n')

/** 按 facts 派生的动态片段（后置；纯函数，仅依赖确定性 facts → 可重建）。 */
function dynamicContext(facts: SystemFacts): string {
  const { ceiling } = facts.scope
  if (ceiling === 'principal') {
    return '当前作用域：可访问你权限范围内的全部知识库；需要选库时用 list_collections 查看再以其 id 检索。'
  }
  const libs = ceiling.map((c) => `《${c.title}》`).join('') || '（空）'
  return `当前作用域被限定在以下知识库内：${libs}。超出此范围的需求无法触达，须如实回报调用方，不要尝试绕过。`
}

/** 组装：稳定模板前置 + 动态片段后置。纯函数，相同入参恒产相同输出。 */
export function assembleSystemPrompt(stableTemplate: string, facts: SystemFacts): string {
  return `${stableTemplate}\n\n${dynamicContext(facts)}`
}
