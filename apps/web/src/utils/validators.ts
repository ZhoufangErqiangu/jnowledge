import type { FormItemRule } from 'element-plus'
import type { z } from 'zod'

/**
 * 把 shared 的 zod schema 直接复用为 Element Plus 表单校验规则。
 * 一份 schema 三用之一：后端校验请求 / z.infer 类型 / 此处前端表单校验。
 */
export function zodRule(schema: z.ZodType, trigger: 'blur' | 'change' = 'blur'): FormItemRule {
  return {
    trigger,
    validator: (_rule, value, callback) => {
      const r = schema.safeParse(value)
      if (r.success) callback()
      else callback(new Error(r.error.issues[0]?.message ?? '校验失败'))
    },
  }
}
