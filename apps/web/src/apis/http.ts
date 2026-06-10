import axios, { type AxiosError } from 'axios'
import type { ErrorResponse } from '@jnowledge/shared'

export const TOKEN_KEY = 'jnowledge.token'

/** 后端地址：由环境变量注入（开发固定本地后端），缺省回退同源。 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

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

export const http = axios.create({ baseURL: API_BASE_URL || '/' })

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
