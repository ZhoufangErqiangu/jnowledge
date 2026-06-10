<script setup lang="ts">
import { SelectRoot } from 'radix-vue'
import { computed } from 'vue'

const model = defineModel<string>()

// radix-vue SelectRoot 要求 modelValue 为 string（非 undefined），
// 未设置时用空字符串保持受控；onUpdate 中再赋值给 model。
const innerValue = computed({
  get: () => model.value ?? '',
  set: (v) => { model.value = v },
})
</script>

<template>
  <SelectRoot v-model="innerValue">
    <slot />
  </SelectRoot>
</template>
