/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BEO_APP_TARGET: "client" | "admin"
  readonly VITE_BEO_API_MODE: string | undefined
  readonly VITE_BEO_API_BASE_URL: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
