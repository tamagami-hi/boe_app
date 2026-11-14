import { createContext, useContext } from "react"

export type UpdatePrompt = Readonly<{
  isAvailable: boolean
  open: () => void
}>

const UNAVAILABLE: UpdatePrompt = Object.freeze({ isAvailable: false, open: () => undefined })

const UpdatePromptContext = createContext<UpdatePrompt>(UNAVAILABLE)

export const UpdatePromptProvider = UpdatePromptContext.Provider

export const useUpdatePrompt = (): UpdatePrompt => useContext(UpdatePromptContext)
