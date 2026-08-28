import type { BackPolicy, BackPolicyInput } from "~/app/native/backPolicy.js"
import { ADMIN_HOME_PATH } from "~/app/routing/adminRoutes.js"

export const backPolicy = (input: BackPolicyInput): BackPolicy => ({
  isTransactional: false,
  parentPath: null,
  isPrimary: true,
  isHome: input.pathname === ADMIN_HOME_PATH,
  isPublic: false,
  homePath: ADMIN_HOME_PATH,
})

export const probeReachability = (): Promise<boolean> => Promise.resolve(false)

const AdminShellRoot = (): React.ReactElement => (
  <main>
    <h1>BeOnEdge Admin</h1>
  </main>
)

export default AdminShellRoot
