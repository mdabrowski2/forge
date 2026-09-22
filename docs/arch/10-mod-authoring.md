# 10 — Mod authoring guide

Write a mod in 5 minutes. No core source reading required — mechanism reference lives in `06-mods.md`.

## Quickstart

```bash
# 1. scaffold (name: lowercase, digits, - _)
bun scripts/mod-create.ts my-mod

# 2. validate (exit 0 = valid, 1 = broken, 2 = no entry file)
bun scripts/mod-check.ts ~/.forge/mods/my-mod

# 3. edit ~/.forge/mods/my-mod/index.js in your editor

# 4. re-check, then press "reload mods" in Forge's settings → mods panel
bun scripts/mod-check.ts ~/.forge/mods/my-mod

# 5. enable per scope in the mods panel (global / this repo / this session)
```

## Recipes

Copy-paste skeletons. Every snippet goes inside `setup(api)`.

**Command** (this is also the scaffold default, verbatim from `MOD_TEMPLATE` in `src/mods/scaffold.ts`):

```js
export default {
  name: "__MOD_NAME__",
  version: "0.1.0",
  setup(api) {
    api.commands.register({
      name: "hello",
      description: "says hello (rename me)",
      run: (args) => "hello " + (args || "world"),
    })
  },
}
```

Replace `__MOD_NAME__` with your folder name, rename `hello` to your `/command`.

**Tool** (the model calls it mid-turn; input is plain JSON Schema):

```js
api.tools.register({
  name: "ticket",
  description: "looks up a ticket by id",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  execute: (input, ctx) => "ticket " + input.id + " (cwd: " + ctx.cwd + ")",
})
```

`ctx` gives `cwd`, boot-time `config`, current `session`, `emit` (send a transparency event), `toolCallId`, and `abortSignal`. Use `ctx.cwd` for file work; use `api.modConfig.get()` (not `api.config.mods[name]`) for settings — it re-resolves session > repo > global live.

**Skill** (opt-in prompt text, loaded per session via the skills panel):

```js
api.skills.register({
  name: "my-conventions",
  description: "team coding conventions for the model",
  content: "Always run the linter before concluding.",
})
```

**Hook** (observe lifecycle; must be fast and non-blocking — a slow hook stalls the turn):

```js
api.hooks.on("beforeToolCall", (p) => console.log("[my-mod] tool:", p.tool))
```

Hook events: `beforeTurn | afterTurn | beforeToolCall | afterToolCall | transparencyEvent`.

**Custom event** (appears in the transparency panel and the events file):

```js
api.events.emit({ type: "custom", callId: "n/a", name: "deploy-started", data: { env: "prod" } })
```

## Scopes (where your mod is on)

Per-mod config resolves session-overrides > repo > global. `enabled` is most-specific-wins; `settings` merge per-key. Worked example (same as `06-mods.md`):

- global `{enabled:true, settings:{a:1,b:1}}` + repo `{settings:{b:2}}` + session `{enabled:false}` → resolved `{enabled:false, settings:{a:1,b:2}}` (session disables; settings merge per-key).

Toggle in the mods panel per scope tab, or edit `~/.forge/config.json` (`mods` key) directly.

## Debugging

- `mod-check` exits: `0` valid (`valid: name=… commands=[…]`), `1` broken (`invalid: <reason>`), `2` no entry file (`index.{js,mjs} missing`).
- Broken mods in the app: the mods panel row shows status `failed` plus the `mod-error` row with the message (`public/app.js:552-557`); boot logs `[mods] <name>: <error>`; `[mods] dir:` tells you which folder was scanned.
- Reload semantic: "reload mods" resets registrations then loads current disk state, so a reload with a newly-broken mod *unregisters* its previous contributions until you fix and reload again. Reload twice with no edits: identical `loaded` lists, never a duplicate-registration error.
- Reload picks up edited files (staged fresh import); restart is never required for mod changes. Constraint: keep mods self-contained at setup time — post-setup lazy relative imports are unsupported on the reload path (boot path unaffected).

## Trust note

Mods run in-process with full Node power (remote code execution): a mod can read your files and run commands as you. Only install mods you trust. Trust boundary: `01-context.md`.
