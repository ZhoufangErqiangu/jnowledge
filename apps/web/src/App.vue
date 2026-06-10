<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
</script>

<template>
  <router-view />
  <Toaster rich-colors position="top-right" />
  <ConfirmDialog />
</template>
