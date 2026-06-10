<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 disabled:pointer-events-none disabled:opacity-40 hover:scale-[1.01] active:scale-[0.99]',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-white shadow-lg shadow-brand/25 hover:bg-brand/90',
        ghost:
          'hover:bg-white/[0.06] hover:text-white text-white/70',
        danger:
          'text-red-400/80 hover:bg-red-500/10 hover:text-red-400',
        outline:
          'border border-white/[0.12] bg-transparent hover:bg-white/[0.05] text-white/80',
        gradient:
          'bg-gradient-to-r from-brand to-brand-violet text-white shadow-lg shadow-brand/25 hover:opacity-90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonVariants = VariantProps<typeof buttonVariants>

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant']
    size?: ButtonVariants['size']
    disabled?: boolean
    loading?: boolean
    class?: string
    type?: 'button' | 'submit' | 'reset'
  }>(),
  { variant: 'default', size: 'default', type: 'button' },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <svg
      v-if="loading"
      class="animate-spin h-3.5 w-3.5 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
    <slot />
  </button>
</template>
