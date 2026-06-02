<script setup lang="ts">
import { Moon, Sunny } from '@element-plus/icons-vue'
import { useTheme } from '@/hooks/useTheme'

const { isDark, toggle } = useTheme()
</script>

<template>
  <el-switch
    :model-value="isDark"
    inline-prompt
    :active-icon="Moon"
    :inactive-icon="Sunny"
    aria-label="切换暗色主题"
    @change="toggle"
  />
</template>
