import { createRouter, createWebHistory } from 'vue-router'
import { TOKEN_KEY } from '@/apis/http'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue') },
    {
      path: '/',
      component: () => import('@/views/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/collections' },
        {
          path: 'collections',
          name: 'collections',
          component: () => import('@/views/CollectionsView.vue'),
        },
        {
          path: 'documents/:id',
          name: 'document',
          component: () => import('@/views/DocumentDetailView.vue'),
        },
        {
          path: 'collections/:collectionId/chat',
          name: 'chat',
          component: () => import('@/views/ChatView.vue'),
        },
      ],
    },
  ],
})

// 全局守卫：未登录跳登录页
router.beforeEach((to) => {
  const hasToken = Boolean(localStorage.getItem(TOKEN_KEY))
  if (to.meta.requiresAuth && !hasToken) return { name: 'login' }
  if (to.name === 'login' && hasToken) return { path: '/' }
  return true
})

export default router
