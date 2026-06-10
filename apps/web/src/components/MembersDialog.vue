<script setup lang="ts">
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { COLLECTION_ROLES, type CollectionMember, type CollectionRole } from '@jnowledge/shared'
import { collectionsApi } from '@/apis/collections'
import { ApiError } from '@/apis/http'
import Dialog from '@/components/ui/Dialog.vue'
import DialogContent from '@/components/ui/DialogContent.vue'
import DialogHeader from '@/components/ui/DialogHeader.vue'
import DialogTitle from '@/components/ui/DialogTitle.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import SelectTrigger from '@/components/ui/SelectTrigger.vue'
import SelectContent from '@/components/ui/SelectContent.vue'
import SelectItem from '@/components/ui/SelectItem.vue'
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue'

const props = defineProps<{ modelValue: boolean; collectionId: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const members = ref<CollectionMember[]>([])
const loading = ref(false)
const newUserId = ref('')
const newRole = ref<CollectionRole>('viewer')

async function load() {
  if (!props.collectionId) return
  loading.value = true
  try {
    members.value = await collectionsApi.members(props.collectionId)
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : '加载成员失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => { if (open) load() },
)

async function add() {
  if (!props.collectionId || !newUserId.value) return
  try {
    await collectionsApi.addMember(props.collectionId, { userId: newUserId.value, role: newRole.value })
    newUserId.value = ''
    await load()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : '添加失败')
  }
}

async function remove(userId: string) {
  if (!props.collectionId) return
  try {
    await collectionsApi.removeMember(props.collectionId, userId)
    await load()
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : '移除失败')
  }
}
</script>

<template>
  <Dialog :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogContent class="max-w-[560px]">
      <DialogHeader>
        <DialogTitle>成员管理</DialogTitle>
      </DialogHeader>

      <!-- Skeleton loading -->
      <div v-if="loading" class="space-y-2 my-2">
        <SkeletonBlock v-for="i in 3" :key="i" class="h-10 w-full" />
      </div>

      <!-- Members table -->
      <div v-else-if="members.length > 0" class="rounded-xl border border-white/[0.06] overflow-hidden my-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-white/[0.06] bg-white/[0.02]">
              <th class="text-left px-4 py-2.5 text-white/50 font-medium">邮箱</th>
              <th class="text-left px-4 py-2.5 text-white/50 font-medium">名称</th>
              <th class="text-left px-4 py-2.5 text-white/50 font-medium w-24">角色</th>
              <th class="w-20" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in members"
              :key="m.user.id"
              class="border-b border-white/[0.04]"
            >
              <td class="px-4 py-2.5 text-white/80">{{ m.user.email }}</td>
              <td class="px-4 py-2.5 text-white/60">{{ m.user.displayName }}</td>
              <td class="px-4 py-2.5 text-white/50">{{ m.role }}</td>
              <td class="px-4 py-2.5">
                <button
                  v-if="m.role !== 'owner'"
                  class="text-xs text-red-400/70 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-colors"
                  @click="remove(m.user.id)"
                >
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="text-center text-white/30 text-sm py-4 my-2">暂无成员</div>

      <!-- Add member row -->
      <div class="flex gap-2 mt-2">
        <Input v-model="newUserId" placeholder="用户 ID（UUID）" class="flex-1" />
        <Select v-model="newRole">
          <SelectTrigger class="w-28" :placeholder="newRole" />
          <SelectContent>
            <SelectItem v-for="r in COLLECTION_ROLES" :key="r" :value="r">{{ r }}</SelectItem>
          </SelectContent>
        </Select>
        <Button @click="add">添加</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
