/** TypeScript types matching the Python backend models. */

export interface GameConfig {
  name: string;
  path?: string;
  executable: string;
  start_dir?: string;
  proton_version?: string;
  proton_dependencies?: string[];
  proton_sync_paths?: string[];
  categories?: string[];
  launch_options?: string;
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

  interface AppDetailsStore {
    SaveCustomLogoPosition(appOverview: any, position: LogoPosition): Promise<void>;
  }

  interface Window {
    appDetailsStore: AppDetailsStore;
    appStore: any;
  }
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
