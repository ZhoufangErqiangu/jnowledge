import axios, { type AxiosError } from 'axios'
import type { ErrorResponse } from '@jnowledge/shared'

export const TOKEN_KEY = 'jnowledge.token'

/** 规范化的接口错误，组件可据 code 分支处理。 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const http = axios.create({ baseURL: '/' })

// 请求拦截：注入 Bearer token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 响应拦截：把后端 { error: {code,message} } 归一化为 ApiError
http.interceptors.response.use(
  (res) => res,
  (err: AxiosError<ErrorResponse>) => {
    const status = err.response?.status ?? 0
    const body = err.response?.data
    if (body && typeof body === 'object' && 'error' in body) {
      throw new ApiError(body.error.code, body.error.message, status)
    }
    throw new ApiError('NETWORK', err.message || '网络错误', status)
  },
)
