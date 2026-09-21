import { render } from "@opentui/solid"
import { loadConfig } from "./config"
import { loadMods } from "./mods/loader"
import { createOllamaProvider } from "./providers/ollama"
import { createAnthropicProvider } from "./providers/anthropic"
import type { Provider } from "./providers/types"
import { listSessions, loadSession, newSession } from "./sessions/store"
import { App } from "./tui/app"

const main = async () => {
  const config = loadConfig()

  const mods = await loadMods(config)
  for (const f of mods.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  if (mods.loaded.length) console.log(`[mods] loaded: ${mods.loaded.join(", ")}`)

  const providers: Provider[] = []
  for (const pc of config.providers) {
    if (pc.kind === "ollama") {
      providers.push(
        await createOllamaProvider({
          baseURL: pc.baseURL ?? "http://127.0.0.1:11434/v1",
          defaultModel: pc.defaultModel,
        })
      )
    } else if (pc.kind === "anthropic") {
      providers.push(createAnthropicProvider({ apiKey: pc.apiKey, defaultModel: pc.defaultModel }))
    }
  }

  // resume the most recent session, otherwise start a new one
  const sessions = listSessions()
  const session = sessions[0]
    ? (loadSession(sessions[0].id) ?? newSession(providers[0]?.defaultModel ?? ""))
    : newSession(providers[0]?.defaultModel ?? "")

  await render(() => <App providers={providers} session={session} cwd={config.cwd} config={config} />, {
    exitOnCtrlC: true,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})