# Self-Update Design (Stable / Latest main)

**Date:** 2026-10-31  
**Status:** Approved (pending spec review)

## Overview

Add an **Updates** section to Deckyfin's Settings page that shows the installed
version, checks GitHub for a newer build on the chosen channel, and updates
Deckyfin in place through **Decky Loader's own plugin installer**.

Two channels, switchable in Settings:
- **Stable** — the latest tagged GitHub release (`v*`), as published today by
  `.github/workflows/release.yml`.
- **Latest main** — a rolling pre-release rebuilt on every push to `main`.

Requires the GitHub repository (`avivkilloz/deckyfin`) to be public so the API
and the release assets are reachable without authentication.

## Build side (GitHub Actions)

### Version stamp

Every packaged build stamps `plugin.json`:
- `version` — Stable: `X.Y.Z` (from the tag, as today). Main:
  `<base>+main.<sha7>` where `<base>` is the newest `vX.Y.Z` tag reachable
  from the commit (`git describe --tags --abbrev=0 --match 'v*'`, checkout with
  full history), falling back to the repo's `plugin.json` version
  (e.g. `0.1.8+main.9ea1504`). The repo's `plugin.json` still says `0.1.0`, so
  using it directly would make main builds look older than Stable.
- `deckyfin_build` (new object, ignored by Decky):
  `{ "channel": "stable" | "main", "commit": "<full sha>", "built_at": "<ISO8601 UTC>" }`.

Local builds (`deploy.sh` / `deploy-deck.sh`) have no `deckyfin_build` and are
reported as **"Development build"**.

### Packaging

The zip layout stays exactly as in `release.yml` (`deckyfin/` folder at the
root with `main.py`, `plugin.json`, `package.json`, `LICENSE`, `dist/`,
`py_modules/`, `src/assets/`). Packaging moves into a shared script
`scripts/package-plugin.sh <version> <channel>` used by both workflows so the
two zips can't drift.

### Workflows

- `release.yml` (tags `v*`): unchanged behaviour, now via the shared script;
  also attaches `version.json` (`{version, channel: "stable", commit, built_at}`).
- New job in `ci.yml` (or a new `main-build.yml`) on push to `main`, after tests
  and build pass: package with channel `main` and publish to a single
  pre-release with tag **`latest-main`** — the tag is force-moved to the pushed
  commit and the release's assets (`deckyfin.zip`, `version.json`) are replaced.
  The release is marked *pre-release* so GitHub's "latest release" (Stable)
  never points at it.

## Backend

New module `py_modules/deckyfin_updates.py` (pure functions + one fetch layer):

- `read_installed_build(plugin_dir: Path) -> dict` — reads the installed
  `plugin.json`: `{version, channel: "stable"|"main"|None, commit: str|None}`
  (`None` channel = development build).
- `parse_release(release_json: dict) -> dict | None` — from a GitHub release
  API object: `{version, commit, published_at, zip_url, notes_url}` using the
  `deckyfin.zip` asset URL and, when present, `version.json` contents passed in
  separately; `None` if no `deckyfin.zip` asset.
- `compare_builds(installed: dict, latest: dict, channel: str) -> str` —
  `"up_to_date" | "update_available" | "unknown"`:
  - Stable: semantic compare of `X.Y.Z` (installed main/dev builds →
    `"update_available"` when switching to Stable, so the user can go back).
  - Main: commit sha differs → `"update_available"`; same → `"up_to_date"`;
    dev build → `"update_available"`.
- `fetch_latest(channel: str) -> dict` — GitHub REST API via `urllib` with a
  10 s timeout and a `User-Agent`: Stable →
  `GET /repos/avivkilloz/deckyfin/releases/latest`; Main →
  `GET /repos/avivkilloz/deckyfin/releases/tags/latest-main`, plus the
  `version.json` asset for the commit. Network/HTTP errors → structured error.

Channel setting persists in the app config as `update_channel`
(`"stable"` default).

`main.py` callables:
- `get_update_info(channel: str | None = None) -> {installed, latest, status, channel, error}`
  (uses the saved channel when `None`).
- `set_update_channel(channel: str) -> {success}` (`"stable"` | `"main"` only).

The repo slug comes from `plugin.json` → `publish.website`
(`https://github.com/avivkilloz/deckyfin`), with a constant fallback.

## Frontend

### Settings → Updates section

- **Channel** switch: `Stable` / `Latest main` (same chip style as other
  Settings toggles; calls `set_update_channel`, then re-checks).
- **Installed:** version (+ short commit, or "Development build").
- **Latest on <channel>:** version, short commit, published date — or an error
  line ("Couldn't reach GitHub").
- **Status:** "Up to date" / "Update available".
- **"Update Deckyfin"** button, shown only when the status is "Update
  available"; a small **"Check again"** link is always shown:
  - Calls Decky's installer, guarded:
    `window.DeckyBackend.call("utilities/install_plugin", zip_url, "Deckyfin", latest.version, null, 0)`
    (Decky shows its own confirmation and reloads the plugin).
  - Disabled while Deckyfin tasks are running (transfers, dep installs,
    batch add, save syncs, prefix inits) — same `runningTaskCount` used by the
    Restart Steam button — with a hint.
  - If `DeckyBackend.call` is unavailable or throws: show the zip URL and the
    manual steps ("Decky settings → Developer → Install plugin from URL").
- The check runs when the Settings page opens (not on every library load).

### Pure helpers (vitest)

`src/updates.ts`: label/formatting helpers (`describeBuild`, `statusLabel`)
with unit tests; the Decky installer call lives in a small guarded function
(`installViaDecky(url, version): Promise<string | null>`).

## Edge Cases

- No network / GitHub rate limit (60 req/h unauthenticated) → error line;
  installed info still shown; no automatic polling.
- `latest-main` release missing (CI never ran) → "No build on this channel yet".
- Installed from Decky store later (if published there) → treated by version
  like any Stable build.
- Updating while a task runs is blocked in the UI (plugin reload would kill it).
- Settings and game data live in `~/.config/deckyfin` and source folders — not
  touched by an update.

## Testing

- **pytest:** `read_installed_build` (stable, main, dev), `parse_release`
  (asset found / missing), `compare_builds` (stable semver ordering, main sha
  compare, dev builds, channel switch), channel setting persistence and
  validation. Network fetch mocked.
- **vitest:** `describeBuild`, `statusLabel`.
- **CI:** the main-channel job verified by pushing to `main` and checking the
  `latest-main` release assets and the stamped `plugin.json` inside the zip.
- **Manual (device):** switch channels, see status, press Update → Decky's
  prompt → plugin reloads on the new version; offline behaviour.

## Out of Scope

Automatic background update checks/notifications, rollback UI (Stable channel
covers going back), signed builds / hash verification beyond Decky's own.
