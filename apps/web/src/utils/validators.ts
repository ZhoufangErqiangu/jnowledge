import type { z } from 'zod'

type Callback = (error?: Error) => void

/** Zod schema → 表单校验规则（不再依赖 EP）。 */
export function zodRule(schema: z.ZodType, trigger: 'blur' | 'change' = 'blur') {
  return {
    trigger,
    validator: (_rule: unknown, value: unknown, callback: Callback) => {
      const r = schema.safeParse(value)
      if (r.success) callback()
      else callback(new Error(r.error.issues[0]?.message ?? '校验失败'))
    },
  }
}
