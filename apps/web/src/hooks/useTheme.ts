import { computed, ref, watchEffect } from 'vue'

const STORAGE_KEY = 'jnowledge.theme'
type ThemeMode = 'light' | 'dark'

function getInitial(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  // 无历史选择则跟随系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 模块级单例状态：全应用共享同一份主题。
const mode = ref<ThemeMode>(getInitial())

// 同步到 <html class="dark">（Element Plus 暗色钩子）并持久化。
watchEffect(() => {
  document.documentElement.classList.toggle('dark', mode.value === 'dark')
  localStorage.setItem(STORAGE_KEY, mode.value)
})

/** 主题组合式：暗色开关 + 当前模式。 */
export function useTheme() {
  const isDark = computed(() => mode.value === 'dark')
  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
  }
  function set(m: ThemeMode) {
    mode.value = m
  }
  return { mode, isDark, toggle, set }
}
