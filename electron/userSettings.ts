import { app } from "electron"
import fs from "fs"
import path from "path"

export interface UserSettings {
  systemPrompt?: string
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "user-settings.json")
}

export function readUserSettings(): UserSettings {
  try {
    const p = settingsPath()
    if (!fs.existsSync(p)) return {}
    const raw = fs.readFileSync(p, "utf-8")
    return JSON.parse(raw) as UserSettings
  } catch {
    return {}
  }
}

export function loadPersistedSystemPrompt(): string | undefined {
  return readUserSettings().systemPrompt
}

/** Pass `null` to remove stored prompt (use app default). */
export function persistSystemPrompt(text: string | null): void {
  const current = readUserSettings()
  if (text === null || text === "") {
    delete current.systemPrompt
  } else {
    current.systemPrompt = text
  }
  const filePath = settingsPath()
  if (Object.keys(current).length === 0) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return
  }
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf-8")
}
