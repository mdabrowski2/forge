import { render } from "@opentui/solid"
import { loadConfig } from "./config"
import { loadMods } from "./mods/loader"
import { resolveProviders } from "./providers/registry"
import type { Provider } from "./providers/types"
import { listSessions, loadSession, newSession } from "./sessions/store"
import { App } from "./tui/app"

const main = async () => {
  const config = loadConfig()

  const mods = await loadMods(config)
  console.log(`[mods] dir: ${mods.dir}`)
  for (const f of mods.failed) console.error(`[mods] ${f.name}: ${f.error}`)
  if (mods.loaded.length) console.log(`[mods] loaded: ${mods.loaded.join(", ")}`)

  const { providers, skipped }: { providers: Provider[]; skipped: { id: string; reason: string }[] } =
    await resolveProviders(config.providers)
  for (const s of skipped) console.error(`[providers] skipping "${s.id}": ${s.reason}`)

  if (!providers.length || providers.every((p) => p.status === "unconfigured")) {
    console.error(
      "[providers] no usable providers. Configure at least one:\n" +
        "  - start Ollama (local defaults), or\n" +
        "  - set ANTHROPIC_API_KEY, or\n" +
        "  - set MUSE_SPARK_BASE_URL + MUSE_SPARK_API_KEY"
    )
    process.exit(1)
  }

  // resume the most recent session, otherwise start a new one
  const sessions = listSessions()
  const session = sessions[0]
    ? (loadSession(sessions[0].id) ?? newSession(providers[0]?.defaultModel ?? "", config.cwd))
    : newSession(providers[0]?.defaultModel ?? "", config.cwd)

  await render(() => <App providers={providers} session={session} cwd={config.cwd} config={config} />, {
    exitOnCtrlC: true,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})