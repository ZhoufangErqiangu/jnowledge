import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LoginRequest, PublicUser, RegisterRequest } from '@jnowledge/shared'
import { authApi } from '@/apis/auth'
import { TOKEN_KEY } from '@/apis/http'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user = ref<PublicUser | null>(null)

  function setSession(t: string, u: PublicUser) {
    token.value = t
    user.value = u
    localStorage.setItem(TOKEN_KEY, t)
  }

  async function login(req: LoginRequest) {
    const res = await authApi.login(req)
    setSession(res.token, res.user)
  }

  async function register(req: RegisterRequest) {
    const res = await authApi.register(req)
    setSession(res.token, res.user)
  }

  async function fetchMe() {
    user.value = await authApi.me()
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  return { token, user, login, register, fetchMe, logout }
})
