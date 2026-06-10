/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端基址，例如 http://localhost:3000；缺省时回退同源。 */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
