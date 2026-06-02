import type { AuthResponse, LoginRequest, PublicUser, RegisterRequest } from '@jnowledge/shared'
import { http } from './http'

export const authApi = {
  async register(req: RegisterRequest): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/register', req)
    return data
  },
  async login(req: LoginRequest): Promise<AuthResponse> {
    const { data } = await http.post<AuthResponse>('/auth/login', req)
    return data
  },
  async me(): Promise<PublicUser> {
    const { data } = await http.get<PublicUser>('/auth/me')
    return data
  },
}
