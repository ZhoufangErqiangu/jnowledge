<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ThemeToggle from '@/components/ThemeToggle.vue'

const router = useRouter()
const auth = useAuthStore()

onMounted(() => {
  if (!auth.user) auth.fetchMe().catch(() => undefined)
})

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-header class="header">
      <div class="brand" @click="router.push('/collections')">📚 jnowledge</div>
      <el-button text @click="router.push('/collections')">知识库</el-button>
      <el-button text @click="router.push('/chat')">全局助手</el-button>
      <div class="spacer" />
      <ThemeToggle />
      <span class="page-muted">{{ auth.user?.displayName || auth.user?.email }}</span>
      <el-button text type="primary" @click="logout">退出</el-button>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<style scoped lang="less">
.layout {
  height: 100%;
}
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.brand {
  font-weight: 600;
  cursor: pointer;
}
.spacer {
  flex: 1;
}
.main {
  background: var(--el-bg-color-page);
  padding: 16px;
}
</style>
