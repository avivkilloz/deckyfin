/**
 * Module-level session cache for Deckyfin.
 *
 * Decky re-mounts the plugin React tree on every sidebar open, resetting all
 * React state. JS module-level variables survive across mounts for as long as
 * the Decky bundle stays loaded. Each cache here eliminates repeated IPC round-
 * trips for data that doesn't change unless the user takes an explicit action.
 *
 * All caches use undefined-as-miss so null can be a valid cached value
 * (e.g. "game has no art" or "game is not in Steam").
 */

// ── Art URIs ─────────────────────────────────────────────────────────────────
// Invalidate after a successful "Apply Deckyfin Art".

const artCache = new Map<string, string | null>();

export function getCachedArt(gameId: string): string | null | undefined {
  return artCache.get(gameId);
}
export function setCachedArt(gameId: string, uri: string | null): void {
  artCache.set(gameId, uri);
}
export function invalidateArtCache(gameId: string): void {
  artCache.delete(gameId);
}

// ── Steam shortcut info ───────────────────────────────────────────────────────
// Invalidate after add/update/remove/purge Steam shortcut.

type SteamInfoEntry = { app_id: number; unsigned_appid: number };
const steamInfoCache = new Map<string, SteamInfoEntry | null>();

export function getCachedSteamInfo(gameName: string): SteamInfoEntry | null | undefined {
  return steamInfoCache.get(gameName);
}
export function setCachedSteamInfo(gameName: string, info: SteamInfoEntry | null): void {
  steamInfoCache.set(gameName, info);
}
export function invalidateSteamInfoCache(gameName: string): void {
  steamInfoCache.delete(gameName);
}

// ── Source capabilities ───────────────────────────────────────────────────────
// Capabilities depend on source type/path. Stable for the session.

type CapEntry = { can_play: boolean; can_write_config: boolean; can_download_to: boolean };
const capabilitiesCache = new Map<string, CapEntry>();

export function getCachedCapabilities(sourceId: string): CapEntry | undefined {
  return capabilitiesCache.get(sourceId);
}
export function setCachedCapabilities(sourceId: string, caps: CapEntry): void {
  capabilitiesCache.set(sourceId, caps);
}

// ── Game sizes ────────────────────────────────────────────────────────────────
// Key: `${gameName}:${sourceId}`. Stable within a session.

const gameSizeCache = new Map<string, number>();

export function getCachedGameSize(key: string): number | undefined {
  return gameSizeCache.get(key);
}
export function setCachedGameSize(key: string, size: number): void {
  gameSizeCache.set(key, size);
}
