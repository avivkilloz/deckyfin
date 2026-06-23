# Source Enable/Disable Design

**Date:** 2026-06-23  
**Status:** Approved

## Overview

Add an enable/disable toggle to each source in the Settings page. Disabled sources are preserved in config but their games are hidden from the Deckyfin game library.

## Data Model

Add `enabled: boolean` (default `true`) to the `Source` struct in both TypeScript and Python.

**TypeScript** (`src/types.ts`):
```typescript
interface Source {
  id: string;
  name: string;
  type: "local" | "mount" | "agent";
  path: string | null;
  url: string | null;
  enabled: boolean;  // NEW — default true
}
```

**Python** (`py_modules/deckyfin_sources.py`):
- `add_source()` sets `enabled=True` on creation.
- `list_sources()` defaults `enabled` to `True` for existing entries missing the field (backward-compat).

**Persisted in** `~/.config/deckyfin/config.json` under `config["sources"]`.

## Backend API

New function in `deckyfin_sources.py`:
```python
def set_source_enabled(source_id: str, enabled: bool) -> None:
    # Load config.json, find source by id, set enabled flag, save.
```

New RPC in `main.py`:
```python
async def set_source_enabled(self, source_id: str, enabled: bool) -> None:
    deckyfin_sources.set_source_enabled(source_id, enabled)
```

No changes to `list_sources()` — it already returns the full source list including the new field.

## Settings UI (`src/components/SettingsPage.tsx`)

Each source card gains a third action button alongside Rescan and Remove:

- **Source enabled:** shows a "Disable" button.
- **Source disabled:** shows an "Enable" button; the source card is visually dimmed (reduced opacity) to indicate inactive state.

Clicking either button immediately calls `set_source_enabled(source.id, !source.enabled)` then refreshes the sources list — same pattern as the existing Rescan and Remove buttons. No confirmation dialog (action is trivially reversible).

## Game Library Filtering (`src/components/GameLibrary.tsx`)

When building the displayed game list, games from disabled sources are excluded with this rule:

**A game is hidden if ALL of its source copies belong to disabled sources.**

If at least one copy is on an enabled source, the game remains visible. This preserves the existing multi-source merge behaviour.

The filter runs client-side against the `sources` list already held in component state — no additional backend call required.

## Backward Compatibility

- Existing `config.json` entries without `enabled` are treated as `enabled: true`.
- No migration script needed.

## Out of Scope

- Games already added to Steam from a disabled source are not removed from Steam.
- Disabling a source does not prevent background tasks (transfers, installs) already in progress for that source.
