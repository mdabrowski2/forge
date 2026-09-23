# ADR-006: Mod trust flags (no signatures)

- Status: accepted
- Date recorded: 2026-09-23
- Context: mods are in-process RCE; users install them casually. Full code
  signatures need infra nobody operates; doing nothing leaves trust invisible.
- Decision: per-mod `trusted: true` flag in global config (default unset =
  untrusted). Every boot logs + emits a `mods.untrusted` notice listing
  loaded-but-untrusted mods (re-emitted per launch, like other boot notices —
  no persisted warned-state). Mods panels show an `untrusted` badge from the
  flag. Nothing is blocked: flags are visibility, not enforcement.
- Alternatives: signatures — rejected (no signing infra, review burden);
  nothing — rejected (trust stays invisible, contradicting the mission's
  "easily make it their own safely").
- Consequences: users must set `trusted: true` to silence the warning;
  enforcement (block/refuse) is a future decision, not this one.
