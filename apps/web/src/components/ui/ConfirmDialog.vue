<script setup lang="ts">
import { confirmState } from '@/composables/useConfirmDialog'
import Dialog from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader from './DialogHeader.vue'
import DialogTitle from './DialogTitle.vue'
import DialogFooter from './DialogFooter.vue'
import Button from './Button.vue'

function respond(confirmed: boolean) {
  confirmState.value?.resolve(confirmed)
  confirmState.value = null
}
</script>

<template>
  <Dialog :open="confirmState !== null" @update:open="(v) => !v && respond(false)">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>提示</DialogTitle>
      </DialogHeader>
      <p class="text-sm text-white/70 py-1">{{ confirmState?.message }}</p>
      <DialogFooter>
        <Button variant="ghost" @click="respond(false)">取消</Button>
        <Button variant="danger" @click="respond(true)">确认删除</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
