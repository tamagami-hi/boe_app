import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "~/ui/styles/index.css"

const mount = (node: React.ReactNode): void => {
  const container = document.querySelector("#root")
  if (container === null) throw new Error("Missing #root container")
  createRoot(container).render(<StrictMode>{node}</StrictMode>)
}

const boot = async (): Promise<void> => {
  const shell =
    import.meta.env.VITE_BEO_APP_TARGET === "client"
      ? await import("~/shells/client/ClientShellRoot.js")
      : await import("~/shells/admin/AdminShellRoot.js")

  mount(<shell.default />)
}

void boot()
