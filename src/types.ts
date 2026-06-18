/** TypeScript types matching the Python backend models. */

export interface GameConfig {
  id?: string;
  name: string;
  path?: string;
  executable: string;
  start_dir?: string;
  steam_app_id?: number;
  proton_version?: string;
  proton_dependencies?: string[];
  proton_sync_paths?: string[];
  categories?: string[];
  launch_options?: string;
  selected_launchers?: string[];
  collections?: string[];
  needs_restart_after_add?: boolean;
  needs_restart?: boolean;
  /** Persisted snapshot of Steam-affecting fields at last sync time. JSON string. */
  steam_snapshot?: string;
  /** Persisted snapshot of deps at last install time. */
  deps_snapshot?: string[];
  steamgriddb_game_id?: number;
}

export interface GameFolder {
  name: string;
  path: string;
}

export interface SteamUser {
  user_id: string;
  is_logged_in: boolean;
}

export interface ProtonVersion {
  name: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  games_folder: string | null;
}

// ── Steam API type declarations ──────────────────────────────────────────────

/** Steam eAssetType enum for custom artwork. */
export type SteamAssetType = 0 | 1 | 2 | 3 | 4;

export const AssetType: Record<string, SteamAssetType> = {
  GRID_P: 0,  // Portrait capsule
  HERO: 1,    // Hero banner
  LOGO: 2,    // Logo
  GRID_L: 3,  // Landscape wide capsule
  ICON: 4,    // Icon
} as const;

export const ASSET_TYPE_NAMES: Record<SteamAssetType, string> = {
  0: "Capsule",
  1: "Hero",
  2: "Logo",
  3: "Wide Capsule",
  4: "Icon",
};

/** Logo position for Steam shortcuts (prevents blank logos). */
export interface LogoPosition {
  pinnedPosition: "BottomLeft" | "UpperLeft" | "CenterCenter" | "UpperCenter" | "BottomCenter";
  nWidthPct: number;
  nHeightPct: number;
}

/** SteamClient.Apps — custom artwork methods available in CEF context. */
declare global {
  interface SteamClientApps {
    SetCustomArtworkForApp(appId: number, data: string, format: string, assetType: SteamAssetType): Promise<void>;
    ClearCustomArtworkForApp(appId: number, assetType: SteamAssetType): Promise<void>;
    SetShortcutName(appId: number, name: string): void;
  }

  interface SteamClient {
    Apps: SteamClientApps;
  }

  var SteamClient: SteamClient;
}

// ── Multi-source types ────────────────────────────────────────────────────────

export type SourceType = "local" | "mount" | "agent";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path: string | null;
  url: string | null;
}

export interface SourceCapabilities {
  can_play: boolean;
  can_write_config: boolean;
  can_download_to: boolean;
}

export interface SourceDiskUsage {
  used: number;   // bytes
  total: number;
  free: number;
}

export interface GameSource {
  source_id: string;
  source_name: string;
  source_type: SourceType;
  config: GameConfig;
}

export interface MergedGame {
  id: string;
  name: string;
  sources: GameSource[];
}

/** SteamGridDB art URLs response from backend. */
export interface SteamGridArtUrls {
  success: boolean;
  error: string | null;
  game_id: number | null;
  game_name: string | null;
  grid_p: string | null;
  hero: string | null;
  logo: string | null;
  wide: string | null;
}

export interface TransferStatus {
  transfer_id: string;
  game_name: string;
  from_source_id: string;
  to_source_id: string;
  status: "queued" | "running" | "done" | "failed";
  bytes_copied: number;
  total_bytes: number;
  error: string | null;
}
