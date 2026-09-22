# 06 — Mods

All built. A mod is a user-written JavaScript plugin: a folder `~/.forge/mods/<dirName>/` containing `index.js` (or `index.mjs`; no TypeScript — Electron's Node can't import `.ts` without a build step). Its default export is `{name, version, setup(api)}` where `setup` runs once at boot and registers contributions. Note the two names: `dirName` (folder name — the key used in config and on disk) vs `def.name` (the name inside the file — the display/ownership key used in logs and the registry).

What a mod can contribute (pick by use case):
- **Tool**: something the model calls mid-turn (takes JSON input, returns text). Example: a ticket lookup.
- **Command**: a `/name args` shortcut the user types instead of chatting. Example: `/review`.
- **Skill**: prompt text the user opts into per session via the skills panel (off by default). Example: extra coding conventions.
- **Hook**: code that observes lifecycle moments: `beforeTurn|afterTurn|beforeToolCall|afterToolCall|transparencyEvent`.
- **Custom event**: a `transparencyEvent` a mod emits for the UI/log to display.

Minimal shape:
```js
// ~/.forge/mods/hello/index.js
export default { name: "hello", version: "0.1.0",
  setup(api) { api.commands.register({ name: "hello", description: "say hi", run: () => "hi" }) } }
```

## Loader (`src/mods/loader.ts`)

- Skips: non-directories; folders with `config.mods[dirName].enabled === false`; folders with no `index.js`/`index.mjs` (silent — an empty folder is not an error).
- Loads: dynamic `import(entryFile)` → shape check (default export must have string `name` + function `setup`, else recorded as `default export must be { name, version, setup(api) }`) → `createApi(config, def.name)` → `setup(api)`.
- Failures never crash boot: bad shape or a throw during import/setup lands in `failed[]` with the message; both UIs log `[mods] <name>: <error>` and `[mods] loaded: …`.
- `listMods()` never imports mod code (side-effect-free — safe to call from UI panels): it cross-references disk folders + config + the boot-time load result into `{dirName, enabled, settings, status: loaded|failed|disabled, error?}`.

## Registry (`src/mods/registry.ts`, API `src/mods/api.ts`)

Everything is tagged with the owning `def.name`, and enablement is enforced centrally (mods never check it themselves):
- Tools: registering a duplicate tool name throws at boot; `getTools()` wraps each `execute` with a live `isModEnabled` check (disabling mid-session blocks the next call).
- Commands/skills: duplicates throw; `getCommands()` / `getAllSkills()` **exclude** disabled mods entirely (their `/commands` return "unknown command" rather than an error).
- Hooks: `emitHook` skips disabled mods; a throwing hook is logged (`console.error`) and the turn continues.
- Skills: `getLoadedSkillSections()` returns only skill texts the user enabled for this session (`loadedSkills` in session meta — opt-in, off by default).
- Custom events: `emitCustom(mod, {type:'custom', callId, name, data})` fills in `mod` + timestamp; no-ops when no turn is active or the mod is disabled.

Config access: `api.config` is the frozen boot-time snapshot (fine for defaults inside `setup()`); `api.modConfig.get()` re-resolves session-overrides > repo > global fresh on every call — mods must use it for anything read after boot.

Worked scope example: global `{enabled:true, settings:{a:1,b:1}}` + repo `{settings:{b:2}}` + session `{enabled:false}` → resolved `{enabled:false, settings:{a:1,b:2}}` (session disables; settings merge per-key).

## Maker workflow (scaffold → check → reload)

- **Scaffold**: `bun scripts/mod-create.ts <name>` writes `~/.forge/mods/<name>/index.js` from `MOD_TEMPLATE` (`src/mods/scaffold.ts`). Names are restricted to lowercase/digits/`-`/`_`; non-empty dirs are never overwritten.
- **Check**: `bun scripts/mod-check.ts <modDir>` imports the mod in a throwaway process and runs `setup()` against a real API object. Exits `0` valid, `1` broken (prints reason), `2` no entry file. Re-runnable: each run is a fresh process, no registry carryover.
- **Reload**: "reload mods" button (settings → mods) or `forge:reloadMods` IPC: `registry.reset()` then `loadMods(config, modsDir, { fresh: true })` and refresh. Fresh loads stage each mod dir into a new temp dir because Bun caches ESM by path and by directory entries — re-import alone serves stale code. Broken-on-reload unregisters the mod's previous contributions until fixed; reload with no edits is idempotent.
- Boot logs `[mods] dir:` (scanned folder), `[mods] loaded: …`, and per-mod `[mods] <name>: <error>`.

Full tutorial: `10-mod-authoring.md`.
