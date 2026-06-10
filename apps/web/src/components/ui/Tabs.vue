<script setup lang="ts">
import { TabsRoot } from 'radix-vue'

const model = defineModel<string>()
const props = defineProps<{ defaultValue?: string }>()
</script>

<template>
  <TabsRoot v-model="model" :default-value="defaultValue" class="flex flex-col w-full">
    <slot />
  </TabsRoot>
</template>
