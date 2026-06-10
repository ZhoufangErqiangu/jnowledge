<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { loginRequestSchema, passwordSchema, registerRequestSchema } from '@jnowledge/shared'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/apis/http'
import GlassCard from '@/components/ui/GlassCard.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const submitting = ref(false)
const errors = reactive({ email: '', password: '', captcha: '' })
const form = reactive({ email: '', password: '', captcha: '' })

function validate() {
  errors.email = ''
  errors.password = ''
  errors.captcha = ''
  const emailResult = z.email('请输入合法邮箱').safeParse(form.email)
  if (!emailResult.success) { errors.email = emailResult.error.issues[0]?.message ?? ''; return false }
  const pwResult = passwordSchema.safeParse(form.password)
  if (!pwResult.success) { errors.password = pwResult.error.issues[0]?.message ?? ''; return false }
  if (mode.value === 'register') {
    const cResult = z.string().min(1, '请输入验证码').safeParse(form.captcha)
    if (!cResult.success) { errors.captcha = cResult.error.issues[0]?.message ?? ''; return false }
  }
  return true
}

async function submit() {
  if (!validate()) return
  submitting.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(loginRequestSchema.parse({ email: form.email, password: form.password }))
    } else {
      await auth.register(
        registerRequestSchema.parse({
          email: form.email,
          password: form.password,
          captcha: form.captcha,
        }),
      )
    }
    await router.push('/')
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : '操作失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-base relative overflow-hidden">
    <!-- Ambient gradient orbs -->
    <div
      class="absolute top-1/4 left-1/4 w-96 h-96 bg-brand/15 rounded-full blur-3xl pointer-events-none"
    />
    <div
      class="absolute bottom-1/4 right-1/4 w-64 h-64 bg-brand-violet/10 rounded-full blur-3xl pointer-events-none"
    />

    <div class="relative z-10 w-[400px] animate-fade-up mx-4">
      <GlassCard class="p-8">
        <h1 class="text-2xl font-bold text-center text-white mb-1">jnowledge</h1>
        <p class="text-center text-white/40 text-sm mb-6">知识库管理平台</p>

        <!-- Mode toggle -->
        <div class="flex rounded-lg bg-white/[0.05] border border-white/[0.06] p-1 mb-6">
          <button
            :class="[
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-all duration-150',
              mode === 'login'
                ? 'bg-brand text-white shadow-sm shadow-brand/30'
                : 'text-white/50 hover:text-white/80',
            ]"
            @click="mode = 'login'"
          >
            登录
          </button>
          <button
            :class="[
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-all duration-150',
              mode === 'register'
                ? 'bg-brand text-white shadow-sm shadow-brand/30'
                : 'text-white/50 hover:text-white/80',
            ]"
            @click="mode = 'register'"
          >
            注册
          </button>
        </div>

        <!-- Form -->
        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="text-sm text-white/60 mb-1.5 block">邮箱</label>
            <Input v-model="form.email" placeholder="you@example.com" type="email" />
            <p v-if="errors.email" class="text-xs text-red-400 mt-1">{{ errors.email }}</p>
          </div>
          <div>
            <label class="text-sm text-white/60 mb-1.5 block">密码</label>
            <Input v-model="form.password" type="password" placeholder="至少 8 位" />
            <p v-if="errors.password" class="text-xs text-red-400 mt-1">{{ errors.password }}</p>
          </div>
          <div v-if="mode === 'register'">
            <label class="text-sm text-white/60 mb-1.5 block">验证码</label>
            <Input v-model="form.captcha" placeholder="请输入验证码" />
            <p v-if="errors.captcha" class="text-xs text-red-400 mt-1">{{ errors.captcha }}</p>
          </div>
          <Button
            type="submit"
            variant="gradient"
            class="w-full mt-2"
            :loading="submitting"
          >
            {{ mode === 'login' ? '登录' : '注册并登录' }}
          </Button>
        </form>
      </GlassCard>
    </div>
  </div>
</template>
