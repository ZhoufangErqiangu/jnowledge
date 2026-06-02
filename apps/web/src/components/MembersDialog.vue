<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { COLLECTION_ROLES, type CollectionMember, type CollectionRole } from '@jnowledge/shared'
import { collectionsApi } from '@/apis/collections'
import { ApiError } from '@/apis/http'

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
    ElMessage.error(e instanceof ApiError ? e.message : '加载成员失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)

async function add() {
  if (!props.collectionId || !newUserId.value) return
  try {
    await collectionsApi.addMember(props.collectionId, { userId: newUserId.value, role: newRole.value })
    newUserId.value = ''
    await load()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '添加失败')
  }
}

async function remove(userId: string) {
  if (!props.collectionId) return
  try {
    await collectionsApi.removeMember(props.collectionId, userId)
    await load()
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : '移除失败')
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="成员管理"
    width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-table v-loading="loading" :data="members" size="small">
      <el-table-column label="用户" prop="user.email" />
      <el-table-column label="名称" prop="user.displayName" />
      <el-table-column label="角色" prop="role" width="100" />
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button
            v-if="row.role !== 'owner'"
            text
            type="danger"
            size="small"
            @click="remove(row.user.id)"
          >
            移除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="add-row">
      <el-input v-model="newUserId" placeholder="用户 ID（UUID）" />
      <el-select v-model="newRole" style="width: 120px">
        <el-option v-for="r in COLLECTION_ROLES" :key="r" :label="r" :value="r" />
      </el-select>
      <el-button type="primary" @click="add">添加</el-button>
    </div>
  </el-dialog>
</template>

<style scoped lang="less">
.add-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
