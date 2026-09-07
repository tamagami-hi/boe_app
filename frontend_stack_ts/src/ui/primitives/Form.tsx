import type { ReactNode, SyntheticEvent } from "react"

import { FORM_ACTIONS, FORM_ROOT } from "~/ui/recipes/field"

export type FormProps = Readonly<{
  onSubmit: () => void
  actions: ReactNode
  children: ReactNode
}>

export const Form = ({ onSubmit, actions, children }: FormProps): React.ReactElement => (
  <form
    className={FORM_ROOT}
    noValidate
    onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault()
      onSubmit()
    }}
  >
    {children}
    <div className={FORM_ACTIONS}>{actions}</div>
  </form>
)

export const FormActions = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement => (
  <div className={FORM_ACTIONS}>{children}</div>
)
