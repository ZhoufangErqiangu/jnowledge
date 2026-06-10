<script setup lang="ts">
import { computed } from 'vue'
import { LogOut } from 'lucide-vue-next'
import type { PublicUser } from '@jnowledge/shared'
import Avatar from '@/components/ui/Avatar.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import DropdownMenuTrigger from '@/components/ui/DropdownMenuTrigger.vue'
import DropdownMenuContent from '@/components/ui/DropdownMenuContent.vue'
import DropdownMenuItem from '@/components/ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '@/components/ui/DropdownMenuSeparator.vue'

const props = defineProps<{ user: PublicUser | null }>()
defineEmits<{ logout: [] }>()

const displayName = computed(() => props.user?.displayName || props.user?.email || '未登录')
const avatarName = computed(() => props.user?.displayName || props.user?.email || null)
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      class="rounded-full ring-1 ring-white/[0.08] transition-all hover:ring-brand/40 focus-visible:ring-brand/50"
      aria-label="用户菜单"
    >
      <Avatar :name="avatarName" />
    </DropdownMenuTrigger>

    <DropdownMenuContent>
      <div class="flex items-center gap-3 px-2 py-2">
        <Avatar :name="avatarName" class="h-9 w-9" />
        <div class="min-w-0">
          <div class="truncate text-sm px-4 py-3 font-medium text-white/90">{{ displayName }}</div>
          <!-- <div class="truncate text-xs text-white/40">{{ user?.email }}</div> -->
        </div>
      </div>

      <DropdownMenuSeparator />

      <DropdownMenuItem class="text-red-400/80 data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-400" @select="$emit('logout')">
        <LogOut :size="14" />
        退出登录
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
