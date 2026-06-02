import { encode } from 'gpt-tokenizer'

/**
 * token 计量。chunk 尺寸预算按 token 而非字符（中英混排字符数与 token 差异大）。
 * 用 gpt-tokenizer（纯 JS，cl100k）做近似——足够驱动切分边界与 token_count。
 */
export function countTokens(text: string): number {
  if (!text) return 0
  return encode(text).length
}
