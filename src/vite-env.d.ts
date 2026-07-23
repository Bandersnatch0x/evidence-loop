/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MULTIMODAL_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
