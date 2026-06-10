<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import UserMenu from '@/components/UserMenu.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

onMounted(() => {
  if (!auth.user) auth.fetchMe().catch(() => undefined)
})

function logout() {
  auth.logout()
  router.push('/login')
}

const navLinks = [
  { label: '知识库', to: '/collections' },
  { label: '搜索', to: '/search' },
  { label: '全局助手', to: '/chat' },
]

function isActive(path: string) {
  return route.path.startsWith(path)
}
</script>

<template>
  <div class="flex flex-col h-screen bg-base overflow-hidden">
    <!-- Glassmorphism sticky header -->
    <header
      class="sticky top-0 z-50 flex items-center h-14 px-5 gap-3 shrink-0 border-b border-white/[0.06] bg-surface-dark/80 backdrop-blur-xl shadow-[0_1px_0_rgba(99,102,241,0.08)]"
    >
      <button
        class="font-bold text-white/90 hover:text-white transition-colors mr-1 flex items-center gap-1.5 text-sm"
        @click="router.push('/collections')"
      >
        📚 jnowledge
      </button>

      <div class="flex-1" />

      <nav class="flex items-center gap-0.5">
        <button
          v-for="link in navLinks"
          :key="link.to"
          :class="[
            'px-3 py-1.5 rounded-md text-sm transition-all duration-150',
            isActive(link.to)
              ? 'text-brand bg-brand/10'
              : 'text-white/60 hover:text-white/90 hover:bg-white/[0.05]',
          ]"
          @click="router.push(link.to)"
        >
          {{ link.label }}
        </button>
      </nav>

      <div class="ml-2 pl-3 border-l border-white/[0.06]">
        <UserMenu :user="auth.user" @logout="logout" />
      </div>
    </header>

    <main class="flex-1 overflow-auto p-4">
      <router-view />
    </main>
  </div>
</template>
