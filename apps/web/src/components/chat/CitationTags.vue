<script setup lang="ts">
import type { Citation } from '@jnowledge/shared'

// 引用标签行：消息气泡与流式草稿共用。点击抛出对应 citation 由上层跳转。
defineProps<{ citations: Citation[] }>()
const emit = defineEmits<{ select: [citation: Citation] }>()
</script>

<template>
  <div v-if="citations.length" class="cites">
    <el-tag
      v-for="c in citations"
      :key="c.marker"
      size="small"
      class="cite"
      @click="emit('select', c)"
    >
      [{{ c.marker }}] {{ c.documentTitle }}
    </el-tag>
  </div>
</template>

<style scoped lang="less">
.cites {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cite {
  cursor: pointer;
}
</style>
