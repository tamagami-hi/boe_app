import type { BackPolicy, BackPolicyInput } from "~/app/native/backPolicy.js"
import { CLIENT_HOME_PATH } from "~/app/routing/clientRoutes.js"

export const backPolicy = (input: BackPolicyInput): BackPolicy => ({
  isTransactional: false,
  parentPath: null,
  isPrimary: input.pathname === CLIENT_HOME_PATH,
  isHome: input.pathname === CLIENT_HOME_PATH,
  isPublic: false,
  homePath: CLIENT_HOME_PATH,
})

export const probeReachability = (): Promise<boolean> => Promise.resolve(false)

const ClientShellRoot = (): React.ReactElement => (
  <main>
    <h1>BeOnEdge</h1>
  </main>
)

export default ClientShellRoot
