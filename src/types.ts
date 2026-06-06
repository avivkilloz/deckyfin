/** TypeScript types matching the Python backend models. */

export interface GameConfig {
  name: string;
  path?: string;
  executable: string;
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
