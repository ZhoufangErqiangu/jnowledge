import { useRouter } from 'vue-router'
import type { Citation } from '@jnowledge/shared'

/**
 * 引用跳转：到文档详情，带版本与高亮区间。
 * DocumentDetailView 反向解析同一组 query（version / hl），后续可共用。
 */
export function useCitationNav() {
  const router = useRouter()
  function gotoCitation(c: Citation) {
    router.push({
      name: 'document',
      params: { id: c.documentId },
      query: { version: c.versionId, hl: `${c.charStart}-${c.charEnd}` },
    })
  }
  return { gotoCitation }
}
