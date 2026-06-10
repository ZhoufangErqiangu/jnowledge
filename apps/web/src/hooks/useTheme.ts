import { computed, ref, watchEffect } from 'vue'

const STORAGE_KEY = 'jnowledge.theme'
type ThemeMode = 'light' | 'dark'

// 强制深色模式（UI 已去掉切换入口）
function getInitial(): ThemeMode {
  return 'dark'
}

const mode = ref<ThemeMode>(getInitial())

watchEffect(() => {
  document.documentElement.classList.toggle('dark', mode.value === 'dark')
  localStorage.setItem(STORAGE_KEY, mode.value)
})

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
