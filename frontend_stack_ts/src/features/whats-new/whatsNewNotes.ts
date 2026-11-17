import { appTarget } from "~/lib/env"

import { ADMIN_NOTES } from "./adminNotes"
import { CLIENT_NOTES } from "./clientNotes"
import type { WhatsNewNotes } from "./whatsNewEntry"

export const whatsNewNotes = (): WhatsNewNotes => (appTarget() === "client" ? CLIENT_NOTES : ADMIN_NOTES)
