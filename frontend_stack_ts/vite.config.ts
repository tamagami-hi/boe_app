import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

type AppTarget = "client" | "admin"

const resolveAppTarget = (): AppTarget => {
  const requested = process.env.VITE_BEO_APP_TARGET
  return requested === "client" ? "client" : "admin"
}

const appTarget = resolveAppTarget()

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_BEO_APP_TARGET": JSON.stringify(appTarget),
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
          if (id.includes("node_modules")) return "vendor"
          if (id.includes("/src/shells/admin/") || id.includes("/src/features/admin/")) {
            if (id.endsWith(".css")) return undefined
            return "admin"
          }
          return undefined
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
})
