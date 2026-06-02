<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance } from 'element-plus'
import { loginRequestSchema, passwordSchema, registerRequestSchema } from '@jnowledge/shared'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth'
import { zodRule } from '@/utils/validators'
import { ApiError } from '@/apis/http'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const auth = useAuthStore()

const mode = ref<'login' | 'register'>('login')
const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = reactive({ email: '', password: '', captcha: '' })

const rules = {
  email: [zodRule(z.email('请输入合法邮箱'))],
  password: [zodRule(passwordSchema)],
  captcha: [zodRule(z.string().min(1, '请输入验证码'))],
}

async function submit() {
  if (!formRef.value) return
  if (!(await formRef.value.validate().catch(() => false))) return
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
    ElMessage.error(e instanceof ApiError ? e.message : '操作失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="theme-corner">
      <ThemeToggle />
    </div>
    <el-card class="login-card">
      <h2 class="title">jnowledge 知识库</h2>
      <el-radio-group v-model="mode" class="mode">
        <el-radio-button value="login">登录</el-radio-button>
        <el-radio-button value="register">注册</el-radio-button>
      </el-radio-group>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="you@example.com" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item v-if="mode === 'register'" label="验证码" prop="captcha">
          <el-input v-model="form.captcha" placeholder="请输入验证码" />
        </el-form-item>
        <el-button type="primary" :loading="submitting" class="submit" @click="submit">
          {{ mode === 'login' ? '登录' : '注册并登录' }}
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped lang="less">
.login-wrap {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}
.theme-corner {
  position: absolute;
  top: 20px;
  right: 24px;
}
.login-card {
  width: 380px;
}
.title {
  margin: 0 0 16px;
  text-align: center;
}
.mode {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}
.submit {
  width: 100%;
}
</style>
