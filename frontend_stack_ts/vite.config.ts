import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

import { NativeAuthHeaders } from "../packages/contracts/dist/index.js"

type AppTarget = "client" | "admin"

const resolveAppTarget = (): AppTarget => {
  const requested = process.env.VITE_BEO_APP_TARGET
  if (requested === "admin") return "admin"
  if (requested === undefined || requested === "" || requested === "client") return "client"
  throw new Error(
    `VITE_BEO_APP_TARGET must be "client" or "admin", received ${JSON.stringify(requested)}`,
  )
}

const appTarget = resolveAppTarget()

const APP_VERSION_SCHEMA = NativeAuthHeaders.shape["x-app-version"]
const DEV_APP_VERSION = "0.0.0-dev"

const resolveAppVersion = (): string => {
  const supplied = process.env.VITE_BEO_APP_VERSION?.trim() ?? ""
  if (supplied === "") return DEV_APP_VERSION
  const parsed = APP_VERSION_SCHEMA.safeParse(supplied)
  if (parsed.success) return parsed.data
  throw new Error(
    `VITE_BEO_APP_VERSION must be X.Y.Z, X.Y.Z-label or X.Y.Z+label, received ${JSON.stringify(supplied)}`,
  )
}

const appVersion = resolveAppVersion()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_BEO_APP_TARGET": JSON.stringify(appTarget),
    "import.meta.env.VITE_BEO_APP_VERSION": JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      "@beonedge/contracts": fileURLToPath(
        new URL("../packages/contracts/dist/index.js", import.meta.url),
      ),
    },
  },
  css: {
    modules: {
      generateScopedName: "[name]__[local]__[hash:base64:5]",
    },
    transformer: "lightningcss",
  },
  build: {
    target: "es2022",
    cssMinify: "lightningcss",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (/node_modules\/(react|react-dom|scheduler)\//u.test(id)) return "react"
            if (id.includes("node_modules/react-router")) return "router"
            if (id.includes("node_modules/@tanstack")) return "query"
            if (id.includes("node_modules/zod")) return "zod"
            if (/node_modules\/(@capacitor|@capgo|@aparajita)\//u.test(id)) return "app"
            return "vendor"
          }
          if (id.endsWith(".css")) return undefined
          if (id.includes("/src/")) return "app"
          return undefined
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:47502",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/u, ""),
      },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
})
