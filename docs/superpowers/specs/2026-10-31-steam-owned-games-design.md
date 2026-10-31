# Steam Owned Games Design (not-installed Store games, install/uninstall/verify)

**Date:** 2026-10-31  
**Status:** Approved — revised 2026-10-31: install/uninstall/verify dropped; Steam's own game page is the entry point

## Revision (2026-10-31, after device testing)

Deckyfin no longer starts installs, uninstalls or verifies itself. Every game
Steam knows (installed or not) gets **"Open in Steam Library"**, which opens
Steam's own game page where the user installs, uninstalls, verifies or plays.
The clickable Steam icon in the game page's art header does the same. Download
progress display is unchanged. Sections below describing Install / Uninstall /
Verify buttons are superseded by this note.

## Overview

Extend the built-in **Steam Library** source so Deckyfin can also list the
user's **owned but not installed** Steam games, install / uninstall / verify
them through Steam's own dialogs and calls, and show download progress. Every
game page that knows its Steam app id also gets an **"Open in Steam Library"**
button.

This is sub-project **3 of 3** of the Steam sources work:
1. Steam Shortcuts (orphans) — done.
2. Steam Library — installed Store games — done
   (`docs/superpowers/specs/2026-10-30-steam-library-source-design.md`).
3. **Steam Library — owned games, install/uninstall/verify** — this spec.

## Architecture

The owned-game list exists only inside Steam's UI process, where Deckyfin's
frontend runs. So — unlike every other source — not-installed games are built
**in the frontend** and merged into the backend's game list there. The backend
keeps providing installed Store games exactly as in sub-project 2.

All Steam UI APIs used here are internal and undocumented. Every access is
guarded (`typeof` checks + try/catch) and degrades to "feature unavailable",
never to a broken library.

## Backend

Only one change: a per-source option.

- `deckyfin_sources.set_source_option(source_id: str, key: str, value) -> bool`
  — allowed keys per source type: `steam_library` → `{"show_uninstalled"}`.
  Unknown source, disallowed key, or non-bool value → `False`. Persists on the
  source record in `config["sources"]`.
- `list_sources()` defaults `show_uninstalled` to `False` for the
  `steam_library` record (other records unchanged).
- `main.py`: callable `set_source_option(source_id, key, value) -> {success}`.

## Frontend

### `src/steamOwned.ts` (pure helpers + one guarded reader)

- `readOwnedApps(): OwnedApp[]` — reads the owned library from Steam's
  internal stores (`window.collectionStore` / `window.appStore`; exact
  accessors confirmed during implementation), returning
  `{ appid: number; name: string; installed: boolean }`. Any failure → `[]`.
- `filterOwnedGames(apps: RawApp[]): OwnedApp[]` — **pure**: keeps games only
  (Steam app type "game"), drops tools / soundtracks / DLC / demos / hidden
  apps and the tool appids already excluded by the backend.
- `mergeOwnedGames(games: MergedGame[], owned: OwnedApp[], source: Source): MergedGame[]`
  — **pure**: for each owned app with `installed === false`:
  - if a game already has a `steam_library` source with that appid → skip;
  - else if a non-built-in game matches by `steam_app_id`, else by name
    (case-insensitive, skipping targets with a conflicting `steam_app_id`) →
    append a `steam_library` source entry to it;
  - else add a new game `{ id: "steam-<appid>", name, sources: [entry] }`.
  The source entry's config is
  `{ name, executable: "", steam_app_id: appid, installed: false }`.

### `src/hooks/useSteamDownloads.ts`

`useSteamDownloads(): Record<number, DownloadState>` via
`SteamClient.Downloads.RegisterForDownloadItems` (guarded; unregister on
unmount). `DownloadState = { status: "downloading" | "queued" | "verifying"; progress: number /* 0..1 */ }`.
The pure part — mapping Steam's download item payload to `DownloadState` — is
`toDownloadStates(items)` in the same file and unit-tested.

When an app leaves the downloading state with an installed result, the library
reloads its game list (the backend then finds the new manifest).

### Steam actions (guarded live calls)

- Install: `SteamClient.Installs.OpenInstallWizard([appid])`.
- Uninstall: `SteamClient.Installs.OpenUninstallWizard([appid], false)`.
- Verify: `SteamClient.Apps.VerifyApp(appid)`.
- Open in Steam Library: `Navigation.Navigate("/library/app/<appid>")`
  (Store appid, or the shortcut's unsigned appid).

Typings for these go into `src/types.ts`.

## Settings UI

Steam Library card:
- New **"Show not-installed games"** switch (same style as Enable/Disable),
  calling `set_source_option(id, "show_uninstalled", value)`.
- Count line: `N installed` plus ` · M not installed` when the switch is on.
  If the owned library can't be read: ` · owned library unavailable`.

## Library UI (`GameLibrary.tsx`, `GameCard.tsx`)

- When Steam Library is enabled **and** `show_uninstalled` is on, owned
  not-installed games are merged in with `mergeOwnedGames` (computed once per
  game-list load, memoized).
- Not-installed cards are dimmed with a **"Not installed"** badge; art from
  Steam (owned apps have Steam art).
- Downloading cards show a thin progress bar + percentage; queued → "Queued".
- Filter panel: **Installed / Not installed** choice, shown only when the
  switch is on. A game counts as "not installed" when all its sources are
  not-installed Steam Library entries.

## Game page (`GameDetail.tsx`)

**Not-installed Store game** (selected source is `steam_library` with
`installed === false`):
- Shown: art header, Metadata (name, Steam App ID), SteamDB / ProtonDB links,
  and a primary **"⬇ Install"** button (Steam dialog). While downloading or
  queued, the button is replaced by a progress bar with percentage and
  "Downloading in Steam…".
- Hidden: everything needing installed files — Proton, launch options, deps,
  save paths/actions, transfers, Apply to Steam.
- On merged games the source selector still switches to this view.

**Installed Store game** — Steam Actions gains **"Open in Steam Library"**,
**"Verify files"** (progress shown like a download) and **"Uninstall…"**.
After uninstall the game reverts to a not-installed entry (switch on) or
disappears (switch off) on the next reload.

**Any game with a known Steam app id** (source games already in Steam,
orphans) — Steam Actions gains **"Open in Steam Library"**. Hidden when the
appid is unknown.

## Edge Cases

- Steam stores unavailable (API change, still loading at boot) → no
  not-installed games; Settings shows "owned library unavailable"; installed
  games unaffected.
- Family Sharing / borrowed games → listed only if Steam includes them in the
  owned list; no special handling.
- Games hidden in Steam's library → skipped.
- Download finishes while a page is open → that game reloads into the
  installed view.
- Large libraries → owned list computed once per load and memoized; existing
  frontend search/filter path unchanged.

## Testing

- **Backend (pytest):** `set_source_option` persists `show_uninstalled` on the
  Steam Library record; rejects unknown source, disallowed key, non-bool
  value, and other source types; `list_sources` defaults it to `False`.
- **Frontend (new: vitest):** add `vitest` as a dev dependency and an
  `npm test` script (`vitest run`). Unit tests for the pure helpers:
  `filterOwnedGames`, `mergeOwnedGames` (new entry, merge by appid, name
  fallback, conflicting appid, skip already-installed), `toDownloadStates`.
  Tested modules must not import `@decky/*` at module level.
- **Manual (Deck):** toggle on → install via dialog → progress on card/page →
  game becomes installed → verify → uninstall → Open in Steam Library from a
  Store game, an orphan and a source game.
- Existing checks stay: `pytest`, `py_compile`, `tsc --noEmit`, `npm run build`.

## Out of Scope

Buying / Store browsing, wishlist, beta/branch selection, pausing or
reordering the download queue (Steam's Downloads page handles it).
