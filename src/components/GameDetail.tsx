import { VFC, useState, useEffect, useRef } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { GameConfig, MergedGame, GameSource, SourceCapabilities, AssetType } from "../types";
import { useArtwork } from "../hooks/useArtwork";
import { CompactTextField } from "../components/CompactTextField";

const removeGame = callable<[name: string, source_id: string], { success: boolean }>(
  "remove_game"
);
const addSteamShortcut = callable<
  [exe_path: string, app_name: string, start_dir?: string, launch_options?: string, proton_version?: string, collections?: string[], source_id?: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("add_steam_shortcut");
const getSteamShortcut = callable<
  [app_name: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("get_steam_shortcut");
const removeSteamShortcut = callable<
  [app_name: string],
  { success: boolean; error?: string }
>("remove_steam_shortcut");
const purgeSteamGameData = callable<
  [app_name: string],
  { success: boolean; removed_shortcut?: boolean; removed_prefix?: boolean; removed_grid?: boolean; unsigned_appid?: number; errors?: string[] }
>("purge_steam_game_data");
const updateSteamShortcut = callable<
  [app_name: string, exe_path: string, start_dir?: string, launch_options?: string, proton_version?: string, collections?: string[], source_id?: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("update_steam_shortcut");
const listProtonVersions = callable<[], string[]>("list_proton_versions");
const setGameProton = callable<
  [app_id: number, proton_name: string],
  { success: boolean; app_id?: number; proton_name?: string; error?: string }
>("set_game_proton");
const initPrefix = callable<
  [app_id: number, proton_name?: string, reinitialize?: boolean, game_name?: string],
  { success: boolean; prefix_id?: string; app_id?: number; error?: string }
>("init_prefix");
const startDepInstall = callable<
  [game_name: string, source_id: string, pfxid: string, dependencies: string],
  { success: boolean; error: string | null }
>("start_dep_install");
const getDepInstallStatuses = callable<
  [],
  Record<string, { status: string; installed: string[]; failed_deps: string[]; error: string | null }>
>("get_dep_install_statuses");
const clearDepInstallStatus = callable<
  [game_name: string, source_id: string],
  { success: boolean }
>("clear_dep_install_status");
const updateGameConfig = callable<
  [name: string, updates: Record<string, any>, source_id: string],
  { success: boolean }
>("update_game_config");
const scanExes = callable<[subfolder: string, source_id?: string], string[]>("scan_game_exes");
const getGame = callable<
  [name: string, source_id: string],
  { success: boolean; game?: GameConfig }
>("get_game");
const searchSteamgridGames = callable<
  [game_name: string],
  { success: boolean; games: Array<{ id: number; name: string }> }
>("search_steamgrid_games");
const searchSteamApp = callable<
  [game_name: string],
  { success: boolean; results: Array<{ id: number; name: string }>; error?: string }
>("search_steam_app");
const getGameCardArt = callable<[game_name: string], { data_uri: string | null }>("get_game_card_art");
const setGameProcessingState = callable<
  [name: string, state: Record<string, any> | null, source_id: string],
  { success: boolean }
>("set_game_processing_state");
const getGameProcessingState = callable<
  [name: string, source_id: string],
  Record<string, any> | null
>("get_game_processing_state");
const getSourceCapabilities = callable<[source_id: string], SourceCapabilities>(
  "get_source_capabilities"
);
const restartSteam = callable<[], { success: boolean; message?: string }>("restart_steam");
const listSteamCollections = callable<[], string[]>("list_steam_collections");
const listAllSources = callable<[], import("../types").Source[]>("list_sources");
const copyGameConfig = callable<
  [game_name: string, from_source_id: string, to_source_id: string],
  { success: boolean; copy_id?: string; error?: string }
>("copy_game_config");
const listConfigCopyStatuses = callable<
  [],
  Record<string, { copy_id: string; game_name: string; from_source_id: string; to_source_id: string; status: string; error: string | null }>
>("list_config_copy_statuses");
const clearConfigCopyStatus = callable<[copy_id: string], { success: boolean }>("clear_config_copy_status");
const listPrefixInitStatuses = callable<
  [],
  Record<string, { prefix_id: string; game_name: string; app_id: number; status: string; error: string | null }>
>("list_prefix_init_statuses");
const clearPrefixInitStatus = callable<[prefix_id: string], { success: boolean }>("clear_prefix_init_status");
const getUiState = callable<[], Record<string, any>>("get_ui_state");
const saveUiState = callable<[state: Record<string, any>], { success: boolean }>("save_ui_state");
const getGamePrefixPath = callable<[shortcut_app_id: number], string | null>("get_game_prefix_path");
const listDirContents = callable<[path: string], { dirs: string[]; files: string[] }>("list_dir_contents");
const syncSaves = callable<
  [game_name: string, source_id: string, direction: string, shortcut_app_id: number],
  { success: boolean; sync_id?: string; error?: string }
>("sync_saves");
const copySavesBetweenSources = callable<
  [game_name: string, from_source_id: string, to_source_id: string],
  { success: boolean; sync_id?: string; error?: string }
>("copy_saves_between_sources");
const listSaveSyncStatuses = callable<
  [],
  Record<string, { sync_id: string; game_name: string; source_id: string; direction: string; from_source_id?: string; to_source_id?: string; status: string; error: string | null; copied: string[]; saves_dir?: string }>
>("list_save_sync_statuses");
const clearSaveSyncStatus = callable<[sync_id: string], { success: boolean }>("clear_save_sync_status");
const startGameTransfer = callable<
  [game_name: string, from_source_id: string, to_source_id: string],
  { success: boolean; transfer_id?: string; error?: string }
>("start_game_transfer");
const getTransferStatus = callable<
  [transfer_id: string],
  import("../types").TransferStatus | { error: string }
>("get_transfer_status");
const cancelTransfer = callable<
  [transfer_id: string],
  { success: boolean }
>("cancel_transfer");
const listActiveTransfers = callable<
  [],
  import("../types").TransferStatus[]
>("list_active_transfers");
const getGameSize = callable<
  [game_name: string, source_id: string],
  { success: boolean; size: number }
>("get_game_size");
const getPopularDeps = callable<[], string[]>("get_popular_deps");
const getPopularLaunchers = callable<[], { label: string; value: string }[]>("get_popular_launchers");
const getPopularSavePrefixes = callable<[], { label: string; path: string }[]>("get_popular_save_prefixes");
const fetchDeckyfinArtOptions = callable<
  [game_name: string, page: number, game_id?: number],
  { game_id: number | null; urls: string[]; has_more: boolean; error?: string }
>("fetch_deckyfin_art_options");
const applyDeckyfinArt = callable<
  [game_name: string, art_url: string],
  { success: boolean; error?: string }
>("apply_deckyfin_art");
const fetchSteamArtOptions = callable<
  [game_id: number, art_type: string, page: number],
  { urls: string[]; has_more: boolean; error?: string }
>("fetch_steam_art_options");

export type PopularLauncher = { label: string; value: string };

const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Build the final Steam launch options string from selected popular options + custom text.
 *
 * Order: popular env vars → custom env vars → popular wrappers → %command% → custom args
 *
 * %command% is auto-inserted unless already present anywhere in the combined string.
 * Env vars in the custom field (KEY=VALUE tokens) are automatically hoisted before
 * %command% so they are treated as environment variables, not game arguments. */
function buildLaunchOptions(
  selectedLabels: string[],
  launchers: PopularLauncher[],
  customText: string,
): string {
  const values = selectedLabels
    .map((label) => launchers.find((l) => l.label === label)?.value)
    .filter((v): v is string => Boolean(v));

  const popEnvVars = values.filter((v) => ENV_VAR_RE.test(v));
  const popWrappers = values.filter((v) => !ENV_VAR_RE.test(v));
  const custom = customText.trim();

  if (popEnvVars.length === 0 && popWrappers.length === 0) return custom;

  // If %command% already appears anywhere, just concatenate popular options + custom as-is
  const allText = [...popEnvVars, ...popWrappers, custom].filter(Boolean).join(" ");
  if (allText.includes("%command%")) {
    return [...popEnvVars, ...popWrappers, custom].filter(Boolean).join(" ");
  }

  // Auto-insert %command%: classify each custom token by shape
  //   KEY=VALUE  → env var  → before %command%
  //   plain word (no = and no leading - or +) → wrapper → before %command%
  //   starts with - or +  → game arg → after %command%
  const customTokens = custom.split(/\s+/).filter(Boolean);
  const customEnvVars = customTokens.filter((t) => ENV_VAR_RE.test(t));
  const customWrappers = customTokens.filter((t) => !ENV_VAR_RE.test(t) && !/^[-+]/.test(t));
  const customArgs = customTokens.filter((t) => !ENV_VAR_RE.test(t) && /^[-+]/.test(t));

  return [
    ...popEnvVars,
    ...customEnvVars,
    ...popWrappers,
    ...customWrappers,
    "%command%",
    ...customArgs,
  ].filter(Boolean).join(" ");
}

interface Props {
  game: MergedGame;
  onBack: () => void;
  onNeedsRestart?: () => void;
  onNavigateToSettings?: () => void;
  initialSourceId?: string | null;
  runningTaskCount?: number;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: "2px",
  fontSize: "0.85em",
  color: "#aaa",
};

const BTN_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "0.85em",
  cursor: "pointer",
  borderRadius: "4px",
  border: "1px solid #555",
  background: "transparent",
  color: "#e0e0e0",
};

const fmtBytes = (b: number): string => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
};

export const GameDetail: VFC<Props> = ({ game, onBack, onNeedsRestart, onNavigateToSettings, initialSourceId, runningTaskCount = 0 }) => {
  // ── Refs ─────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus Back button on mount so B-button works immediately ──
  useEffect(() => {
    const timer = setTimeout(() => backRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // ── Source selector ────────────────────────────────────────────────────────
  const [selectedSourceIdx, setSelectedSourceIdx] = useState(() => {
    if (initialSourceId) {
      const idx = game.sources.findIndex((s) => s.source_id === initialSourceId);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [capabilities, setCapabilities] = useState<SourceCapabilities>({
    can_play: true,
    can_write_config: true,
    can_download_to: true,
  });

  // ── All sources (for game copy destination picker) ────────────────────
  const [allSources, setAllSources] = useState<import("../types").Source[]>([]);

  // ── Per-source game sizes ─────────────────────────────────────────────
  const [sourceSizes, setSourceSizes] = useState<Record<string, number | null>>({});

  // ── Config copy state ─────────────────────────────────────────────────
  const [showCopyConfigPicker, setShowCopyConfigPicker] = useState(false);
  const [copyConfigDest, setCopyConfigDest] = useState<import("../types").GameSource | null>(null);
  const [copyConfigConfirming, setCopyConfigConfirming] = useState(false);
  const [copyConfigFeedback, setCopyConfigFeedback] = useState<string | null>(null);

  // ── Game transfer state ───────────────────────────────────────────────
  const [showCopyGamePicker, setShowCopyGamePicker] = useState(false);
  const [copyGameDest, setCopyGameDest] = useState<import("../types").Source | null>(null);
  const [copyGameConfirming, setCopyGameConfirming] = useState(false);
  const [copyGameFeedback, setCopyGameFeedback] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<import("../types").TransferStatus | null>(null);

  const selectedSource: GameSource = game.sources[selectedSourceIdx] ?? game.sources[0];
  const currentConfig: GameConfig = selectedSource?.config ?? game.sources[0]?.config ?? { name: game.name, executable: "" };

  // ── Editable config fields ──────────────────────────────────────────────
  const [name, setName] = useState(currentConfig.name);
  const [storedName, setStoredName] = useState(currentConfig.name); // last saved name (lookup key)
  const [executable, setExecutable] = useState(currentConfig.executable);
  const [startDir, setStartDir] = useState(currentConfig.start_dir || "");
  const [steamAppId, setSteamAppId] = useState<number | undefined>(
    currentConfig.steam_app_id
  );
  const [steamAppIdInput, setSteamAppIdInput] = useState(
    currentConfig.steam_app_id != null ? String(currentConfig.steam_app_id) : ""
  );

  const [protonVersion, setProtonVersion] = useState(
    currentConfig.proton_version || ""
  );
  const [protonPickerOpen, setShowProtonPicker] = useState(false);

  const [launchOptions, setLaunchOptions] = useState(
    currentConfig.launch_options || ""
  );

  // ── Collections: toggle chips + custom ─────────────────────────────────
  const [steamCollections, setSteamCollections] = useState<string[]>([]);
  const [checkedCollections, setCheckedCollections] = useState<string[]>([]);
  const [customCollections, setCustomCollections] = useState<string>("");
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);

  const mergedCollections = ((): string[] => {
    const custom = customCollections
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const all = [...checkedCollections, ...custom];
    const seen = new Set<string>();
    return all.filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
  })();

  const toggleCheckedCollection = (name: string) => {
    setCheckedCollections((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  // ── Popular deps list (loaded from settings) ─────────────────────────────
  const [popularDeps, setPopularDeps] = useState<string[]>([]);
  // Ref so async callbacks (getGame, etc.) always read the latest list, not a stale closure
  const popularDepsRef = useRef<string[]>([]);
  // Start empty; partitioned once popularDeps arrive (same pattern as collections)
  const [checkedDeps, setCheckedDeps] = useState<string[]>([]);
  const [customDeps, setCustomDeps] = useState<string>("");

  // ── Popular launchers list (loaded from settings) ─────────────────────────
  const [popularLaunchers, setPopularLaunchers] = useState<PopularLauncher[]>([]);
  const popularLaunchersRef = useRef<PopularLauncher[]>([]);
  const [checkedLaunchers, setCheckedLaunchers] = useState<string[]>([]);

  // ── Custom save prefixes (loaded from settings) ───────────────────────────
  const [customSavePrefixes, setCustomSavePrefixes] = useState<{ label: string; path: string }[]>([]);

  // ── Combined init: game config, popular deps/launchers, ui_state draft ────
  // Runs on mount and whenever game or source changes.
  // Loads everything in parallel so the draft is applied AFTER the saved config,
  // ensuring unsaved form changes survive sidebar close/reopen.
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const [gameRes, uiStateRes, depsRes, launchersRes, savePfxRes] = await Promise.allSettled([
        getGame(game.name, selectedSource.source_id),
        getUiState(),
        getPopularDeps(),
        getPopularLaunchers(),
        getPopularSavePrefixes(),
      ]);
      if (cancelled) return;

      const popularDeps = depsRes.status === "fulfilled" ? (depsRes.value || []) : [];
      const popularLaunchers = launchersRes.status === "fulfilled" ? (launchersRes.value || []) : [];
      popularDepsRef.current = popularDeps;
      setPopularDeps(popularDeps);
      popularLaunchersRef.current = popularLaunchers;
      setPopularLaunchers(popularLaunchers);
      setCustomSavePrefixes(savePfxRes.status === "fulfilled" ? (savePfxRes.value || []) : []);

      if (gameRes.status === "fulfilled" && gameRes.value?.success && gameRes.value.game) {
        const g = gameRes.value.game;
        setName(g.name);
        setStoredName(g.name);
        setExecutable(g.executable);
        setStartDir(g.start_dir || "");
        setSteamAppId(g.steam_app_id);
        setSteamAppIdInput(g.steam_app_id != null ? String(g.steam_app_id) : "");
        setProtonVersion(g.proton_version || "");
        setLaunchOptions(g.launch_options || "");
        const freshDeps = g.proton_dependencies || [];
        setCheckedDeps(freshDeps.filter((d: string) => popularDeps.includes(d)));
        setCustomDeps(freshDeps.filter((d: string) => !popularDeps.includes(d)).join(", "));
        const freshLaunchers = g.selected_launchers || [];
        setCheckedLaunchers(freshLaunchers.filter((lbl: string) => popularLaunchers.some((l: PopularLauncher) => l.label === lbl)));
        const freshColls = g.collections || [];
        setCheckedCollections(freshColls.filter((c: string) => steamCollections.includes(c)));
        setCustomCollections(freshColls.filter((c: string) => !steamCollections.includes(c)).join(", "));
        setNeedsRestart(g.needs_restart ?? false);
        setNeedsRestartAfterAdd(g.needs_restart_after_add ?? false);
        setSyncPaths(g.proton_sync_paths || []);
        setConfigSnapshot({
          name: g.name, executable: g.executable, start_dir: g.start_dir || null,
          steam_app_id: g.steam_app_id ?? null, proton_version: g.proton_version || null,
          proton_dependencies: g.proton_dependencies || [],
          proton_sync_paths: g.proton_sync_paths || [],
          launch_options: g.launch_options || null,
          selected_launchers: g.selected_launchers || [], collections: g.collections || [],
          steamgriddb_game_id: g.steamgriddb_game_id ?? null,
        });
        if (g.steam_snapshot) {
          try { setLastSyncedSnapshot(JSON.parse(g.steam_snapshot)); } catch {}
        } else {
          setLastSyncedSnapshot(null);
        }
        setLastInstalledDeps(g.deps_snapshot ?? []);
      }

      // Apply saved draft on top to restore any unsaved form changes
      const uiState = uiStateRes.status === "fulfilled" ? uiStateRes.value : null;
      const draft = (uiState?.game_name === game.name && uiState?.source_id === selectedSource.source_id && uiState?.draft)
        ? uiState.draft : null;
      if (draft) {
        if (draft.name !== undefined) setName(draft.name);
        if (draft.executable !== undefined) setExecutable(draft.executable);
        if (draft.start_dir !== undefined) setStartDir(draft.start_dir);
        if (draft.steam_app_id !== undefined) {
          setSteamAppId(draft.steam_app_id ?? undefined);
          setSteamAppIdInput(draft.steam_app_id != null ? String(draft.steam_app_id) : "");
        }
        if (draft.proton_version !== undefined) setProtonVersion(draft.proton_version);
        if (draft.launch_options !== undefined) setLaunchOptions(draft.launch_options);
        if (draft.checked_launchers !== undefined) setCheckedLaunchers(draft.checked_launchers);
        if (draft.checked_deps !== undefined) setCheckedDeps(draft.checked_deps);
        if (draft.custom_deps !== undefined) setCustomDeps(draft.custom_deps);
        if (draft.checked_collections !== undefined) setCheckedCollections(draft.checked_collections);
        if (draft.custom_collections !== undefined) setCustomCollections(draft.custom_collections);
        if (draft.sync_paths !== undefined) setSyncPaths(draft.sync_paths);
      }
    };
    init().catch(() => {});
    return () => { cancelled = true; };
  }, [game.name, selectedSource?.source_id]);

  const mergedDeps = ((): string[] => {
    const custom = customDeps
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const all = [...checkedDeps, ...custom];
    // Deduplicate preserving order (first seen wins)
    const seen = new Set<string>();
    return all.filter((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
  })();

  const toggleCheckedDep = (id: string) => {
    setCheckedDeps((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleCheckedLauncher = (label: string) => {
    setCheckedLaunchers((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const finalLaunchOptions = buildLaunchOptions(checkedLaunchers, popularLaunchers, launchOptions);

  // ── Steam integration ───────────────────────────────────────────────────
  const [steamInfo, setSteamInfo] = useState<{
    app_id: number;
    unsigned_appid: number;
  } | null>(null);
  const [currentProton, setCurrentProton] = useState<string | null>(null);

  // ── Loading states ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState<string | null>(null); // which action is running
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [configFeedback, setConfigFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sgdbFeedback, setSgdbFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [restarting, setRestarting] = useState(false);

  // ── Green button state ────────────────────────────────────────────────────
  // Snapshots of what was last synced/installed — computed comparison drives green
  // Initialize from game prop's persisted snapshots directly (not async getGame)
  // so the first render already has correct comparison values.
  // null = no prior sync at all → steamNeedsSync will show green (unknown state)
  const [lastSyncedSnapshot, setLastSyncedSnapshot] = useState(() => {
    if (currentConfig.steam_snapshot) {
      try { return JSON.parse(currentConfig.steam_snapshot); } catch {}
    }
    return null;
  });
  const [lastInstalledDeps, setLastInstalledDeps] = useState<string[]>(
    () => currentConfig.deps_snapshot ?? []
  );

  // Snapshot of last-saved config — used to detect unsaved changes (Apply Config green)
  const [configSnapshot, setConfigSnapshot] = useState(() => ({
    name: currentConfig.name,
    executable: currentConfig.executable,
    start_dir: currentConfig.start_dir || null,
    steam_app_id: currentConfig.steam_app_id ?? null,
    proton_version: currentConfig.proton_version || null,
    proton_dependencies: currentConfig.proton_dependencies || [],
    proton_sync_paths: currentConfig.proton_sync_paths || [],
    launch_options: currentConfig.launch_options || null,
    selected_launchers: currentConfig.selected_launchers || [],
    collections: currentConfig.collections || [],
    steamgriddb_game_id: currentConfig.steamgriddb_game_id ?? null,
  }));

  // ── Confirmation state (inline, CEF confirm() is blocked) ──────────────
  const [confirming, setConfirming] = useState<"steam" | "deckyfin" | "purge" | null>(null);
  const [needsRestartAfterAdd, setNeedsRestartAfterAdd] = useState(
    currentConfig.needs_restart_after_add ?? false
  );
  const [needsRestart, setNeedsRestart] = useState(
    currentConfig.needs_restart ?? false
  );

  // ── Executable picker ───────────────────────────────────────────────────
  const [showExePicker, setShowExePicker] = useState(false);
  const [exeOptions, setExeOptions] = useState<string[]>([]);
  const [scanRoot, setScanRoot] = useState(""); // subfolder scanned for exes

  // ── SGDB game picker ───────────────────────────────────────────────────
  const [sgdbGames, setSgdbGames] = useState<Array<{ id: number; name: string }>>([]);
  const [showSgdbPicker, setShowSgdbPicker] = useState(false);
  const [selectedSgdbGame, setSelectedSgdbGame] = useState<{ id: number; name: string } | null>(null);
  const [sgdbGameId, setSgdbGameId] = useState<number | null>(currentConfig.steamgriddb_game_id ?? null);
  const [sgdbGameIdInput, setSgdbGameIdInput] = useState(currentConfig.steamgriddb_game_id != null ? String(currentConfig.steamgriddb_game_id) : "");
  const [showSteamAppPicker, setShowSteamAppPicker] = useState(false);
  const [steamAppResults, setSteamAppResults] = useState<Array<{ id: number; name: string }>>([]);

  // ── Dep install background tracking ──────────────────────────────────────
  type DepInstallEntry = { status: string; installed: string[]; failed_deps: string[]; error: string | null };
  const [depInstall, setDepInstall] = useState<DepInstallEntry | null>(null);
  const pendingDepsRef = useRef<string[]>([]);

  // ── Config copy background tracking ──────────────────────────────────────
  type ConfigCopyEntry = { copy_id: string; status: string; error: string | null };
  const [configCopy, setConfigCopy] = useState<ConfigCopyEntry | null>(null);

  // ── Prefix init background tracking ──────────────────────────────────────
  type PrefixInitEntry = { prefix_id: string; status: string; error: string | null };
  const [prefixInit, setPrefixInit] = useState<PrefixInitEntry | null>(null);

  // ── Save paths & sync tracking ────────────────────────────────────────────
  const [syncPaths, setSyncPaths] = useState<string[]>(currentConfig.proton_sync_paths || []);
  const [selectedPfx, setSelectedPfx] = useState("Roaming");
  const [syncSuffix, setSyncSuffix] = useState("");
  type SaveSyncEntry = { sync_id: string; direction: string; status: string; error: string | null; copied: string[]; from_source_id?: string; to_source_id?: string; saves_dir?: string };
  const [saveSync, setSaveSync] = useState<SaveSyncEntry | null>(null);
  const [showCopySavesPicker, setShowCopySavesPicker] = useState(false);
  const [copySavesDest, setCopySavesDest] = useState<GameSource | null>(null);
  const [copySavesConfirming, setCopySavesConfirming] = useState(false);

  // ── Proton versions ─────────────────────────────────────────────────────
  const [protonVersions, setProtonVersions] = useState<string[]>([]);

  // ── Prefix file browser ───────────────────────────────────────────────────
  const [showPrefixBrowser, setShowPrefixBrowser] = useState(false);
  const [showLaunchOptions, setShowLaunchOptions] = useState(false);
  const [showCollections, setShowCollections] = useState(false);
  const [showDependencies, setShowDependencies] = useState(false);
  const [showProtonVersion, setShowProtonVersion] = useState(false);
  const [showSavePaths, setShowSavePaths] = useState(false);
  const [showGameSettings, setShowGameSettings] = useState(false);
  const [showSteamActions, setShowSteamActions] = useState(false);
  const [showArtActions, setShowArtActions] = useState(false);
  type SteamArtTab = "wide" | "capsule" | "hero" | "logo" | "icon";
  const [steamArtTab, setSteamArtTab] = useState<SteamArtTab>("wide");
  const [steamArtOptions, setSteamArtOptions] = useState<string[]>([]);
  const [steamArtOptionIdx, setSteamArtOptionIdx] = useState(0);
  const [steamArtOptionsLoading, setSteamArtOptionsLoading] = useState(false);
  const [steamArtPage, setSteamArtPage] = useState(0);
  const [steamArtHasMore, setSteamArtHasMore] = useState(false);
  const [steamArtFetchingMore, setSteamArtFetchingMore] = useState(false);
  const [steamArtLoadedUrls, setSteamArtLoadedUrls] = useState<Set<string>>(new Set());
  const [artOptions, setArtOptions] = useState<string[]>([]);
  const [artOptionIdx, setArtOptionIdx] = useState(0);
  const [artOptionsLoading, setArtOptionsLoading] = useState(false);
  const [artGameId, setArtGameId] = useState<number | null>(null);
  const [artPage, setArtPage] = useState(0);
  const [artHasMore, setArtHasMore] = useState(false);
  const [artFetchingMore, setArtFetchingMore] = useState(false);
  const [artLoadedUrls, setArtLoadedUrls] = useState<Set<string>>(new Set());
  const [showPrefixActions, setShowPrefixActions] = useState(false);
  const [showTransferActions, setShowTransferActions] = useState(false);
  const [showSaveActions, setShowSaveActions] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showReinitConfirm, setShowReinitConfirm] = useState(false);
  const [pfxBrowseFeedback, setPfxBrowseFeedback] = useState<string | null>(null);
  const [prefixRoot, setPrefixRoot] = useState<string | null>(null);
  const [pfxBrowserPath, setPfxBrowserPath] = useState<string>("");
  const [pfxBrowserDirs, setPfxBrowserDirs] = useState<string[]>([]);
  const [pfxBrowserFiles, setPfxBrowserFiles] = useState<string[]>([]);
  const [pfxBrowserLoading, setPfxBrowserLoading] = useState(false);

  // ── Artwork ───────────────────────────────────────────────────────────────
  const { applyArtById, applyArtByType } = useArtwork();
  const [headerArtUri, setHeaderArtUri] = useState<string | null>(null);
  useEffect(() => {
    getGameCardArt(game.name)
      .then((r) => setHeaderArtUri(r.data_uri || null))
      .catch(() => setHeaderArtUri(null));
  }, [game.name]);

  // ── Load capabilities when source changes ─────────────────────────────────
  useEffect(() => {
    if (!selectedSource) return;
    getSourceCapabilities(selectedSource.source_id)
      .then(setCapabilities)
      .catch(() => setCapabilities({ can_play: true, can_write_config: true, can_download_to: true }));
  }, [selectedSource?.source_id]);

  // ── Reload config state when selected source changes ──────────────────────
  useEffect(() => {
    if (!currentConfig) return;
    setName(currentConfig.name);
    setStoredName(currentConfig.name);
    setExecutable(currentConfig.executable);
    setStartDir(currentConfig.start_dir || "");
    setSteamAppId(currentConfig.steam_app_id);
    setSteamAppIdInput(currentConfig.steam_app_id != null ? String(currentConfig.steam_app_id) : "");
    setSgdbGameId(currentConfig.steamgriddb_game_id ?? null);
    setSelectedSgdbGame(null);
    setProtonVersion(currentConfig.proton_version || "");
    setLaunchOptions(currentConfig.launch_options || "");
    const srcDeps = currentConfig.proton_dependencies || [];
    const pd = popularDepsRef.current;
    setCheckedDeps(srcDeps.filter((d) => pd.includes(d)));
    setCustomDeps(srcDeps.filter((d) => !pd.includes(d)).join(", "));
    const srcLaunchers = currentConfig.selected_launchers || [];
    const pl = popularLaunchersRef.current;
    setCheckedLaunchers(srcLaunchers.filter((lbl) => pl.some((l) => l.label === lbl)));
    const srcColls = currentConfig.collections || [];
    setCheckedCollections(srcColls.filter((c) => steamCollections.includes(c)));
    setCustomCollections(srcColls.filter((c) => !steamCollections.includes(c)).join(", "));
    if (currentConfig.steam_snapshot) {
      try { setLastSyncedSnapshot(JSON.parse(currentConfig.steam_snapshot)); } catch { setLastSyncedSnapshot(null); }
    } else {
      setLastSyncedSnapshot(null);
    }
    setLastInstalledDeps(currentConfig.deps_snapshot ?? []);
    setConfigSnapshot({
      name: currentConfig.name,
      executable: currentConfig.executable,
      start_dir: currentConfig.start_dir || null,
      steam_app_id: currentConfig.steam_app_id ?? null,
      proton_version: currentConfig.proton_version || null,
      proton_dependencies: currentConfig.proton_dependencies || [],
      proton_sync_paths: currentConfig.proton_sync_paths || [],
      launch_options: currentConfig.launch_options || null,
      selected_launchers: currentConfig.selected_launchers || [],
      collections: currentConfig.collections || [],
      steamgriddb_game_id: currentConfig.steamgriddb_game_id ?? null,
    });
    setNeedsRestartAfterAdd(currentConfig.needs_restart_after_add ?? false);
    setNeedsRestart(currentConfig.needs_restart ?? false);
  }, [selectedSourceIdx]);

  useEffect(() => {
    listProtonVersions().then(setProtonVersions).catch(() => setProtonVersions([]));
  }, []);

  useEffect(() => {
    // Mark all sources as loading (null), then fetch sizes one by one
    setSourceSizes(Object.fromEntries(game.sources.map((s) => [s.source_id, null])));
    game.sources.forEach((src) => {
      getGameSize(game.name, src.source_id)
        .then((res) => {
          if (res.success) {
            setSourceSizes((prev) => ({ ...prev, [src.source_id]: res.size }));
          }
        })
        .catch(() => {});
    });
  }, [game.name]);

  useEffect(() => {
    listAllSources().then(setAllSources).catch(() => {});
    listActiveTransfers()
      .then((transfers) => {
        // Only reconnect to truly running transfers — skip cancelled ones still winding down
        const mine = transfers.find(
          (t) => t.game_name === game.name && (t.status === "running" || t.status === "queued"),
        );
        if (mine) {
          setTransferId(mine.transfer_id);
          setTransferStatus(mine);
        }
      })
      .catch(() => {});
  }, [game.name]);

  useEffect(() => {
    if (!transferId) return;
    const poll = setInterval(async () => {
      try {
        const s = await getTransferStatus(transferId);
        if ("error" in s && (s as { error: string }).error === "not found") {
          clearInterval(poll);
          setTransferId(null);
          setTransferStatus(null);
          return;
        }
        const ts = s as import("../types").TransferStatus;
        setTransferStatus(ts);
        if (ts.status !== "running" && ts.status !== "queued") clearInterval(poll);
      } catch (_) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [transferId]);

  useEffect(() => {
    getSteamShortcut(game.name)
      .then((res) => {
        if (res.success && res.app_id && res.unsigned_appid) {
          setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        }
      })
      .catch(() => {});
  }, [game.name]);

  // ── Fetch existing Steam collections on mount ───────────────────────────
  useEffect(() => {
    listSteamCollections().then((collections) => {
      setSteamCollections(collections);
      // Partition game's existing collections into known vs custom
      const existing = currentConfig.collections || [];
      const knownColls = existing.filter((c) => collections.includes(c));
      const customColls = existing.filter((c) => !collections.includes(c));
      setCheckedCollections(knownColls);
      setCustomCollections(customColls.join(", "));
      setCollectionsLoaded(true);
    }).catch(() => {
      setSteamCollections([]);
      setCollectionsLoaded(true);
    });
  }, [game.name]);

  // ── Restore dep install status on mount (survives navigation) ────────────
  useEffect(() => {
    getDepInstallStatuses()
      .then((statuses) => {
        const key = `${game.name}|${selectedSource.source_id}`;
        const s = statuses?.[key];
        if (s) {
          setDepInstall(s);
          if (s.status === "done") {
            const installed = s.installed || [];
            setLastInstalledDeps(installed);
            updateGameConfig(storedName, { deps_snapshot: installed }, selectedSource.source_id).catch(() => {});
            clearDepInstallStatus(game.name, selectedSource.source_id).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [game.name, selectedSource?.source_id]);

  // ── Poll dep install status while installing ───────────────────────────
  useEffect(() => {
    if (!depInstall || depInstall.status !== "installing") return;
    const poll = setInterval(async () => {
      try {
        const statuses = await getDepInstallStatuses();
        const key = `${game.name}|${selectedSource.source_id}`;
        const s = statuses?.[key];
        if (!s || s.status !== "installing") {
          clearInterval(poll);
          if (s) {
            setDepInstall(s);
            if (s.status === "done") {
              const deps = pendingDepsRef.current;
              setLastInstalledDeps(deps);
              updateGameConfig(storedName, { deps_snapshot: deps }, selectedSource.source_id).catch(() => {});
              clearDepInstallStatus(game.name, selectedSource.source_id).catch(() => {});
            }
          } else {
            setDepInstall(null);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [depInstall?.status, game.name, selectedSource?.source_id]);

  // ── Poll config copy status while running ─────────────────────────────
  useEffect(() => {
    if (!configCopy || configCopy.status !== "running") return;
    const poll = setInterval(async () => {
      try {
        const statuses = await listConfigCopyStatuses();
        const s = statuses?.[configCopy.copy_id];
        if (!s || s.status !== "running") {
          clearInterval(poll);
          setConfigCopy(s ? { copy_id: s.copy_id, status: s.status, error: s.error } : null);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(poll);
  }, [configCopy?.status, configCopy?.copy_id]);

  // ── Poll prefix init status while running ─────────────────────────────
  useEffect(() => {
    if (!prefixInit || prefixInit.status !== "running") return;
    const poll = setInterval(async () => {
      try {
        const statuses = await listPrefixInitStatuses();
        const s = statuses?.[prefixInit.prefix_id];
        if (!s || s.status !== "running") {
          clearInterval(poll);
          setPrefixInit(s ? { prefix_id: s.prefix_id, status: s.status, error: s.error } : null);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [prefixInit?.status, prefixInit?.prefix_id]);

  // ── Poll save sync status while running ───────────────────────────────────
  useEffect(() => {
    if (!saveSync || saveSync.status !== "running") return;
    const poll = setInterval(async () => {
      try {
        const statuses = await listSaveSyncStatuses();
        const s = statuses?.[saveSync.sync_id];
        if (!s || s.status !== "running") {
          clearInterval(poll);
          setSaveSync(s ? { sync_id: s.sync_id, direction: s.direction, status: s.status, error: s.error, copied: s.copied, from_source_id: s.from_source_id, to_source_id: s.to_source_id, saves_dir: s.saves_dir } : null);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [saveSync?.status, saveSync?.sync_id]);

  // ── Save sync handlers ────────────────────────────────────────────────────
  type SaveSyncRes = { success: boolean; sync_id?: string; error?: string };

  const handleBackupSaves = async () => {
    if (!steamInfo) return;
    const res: SaveSyncRes = await syncSaves(game.name, selectedSource.source_id, "backup", steamInfo.unsigned_appid).catch((e) => ({ success: false, error: String(e) }));
    if (res.success && res.sync_id) {
      setSaveSync({ sync_id: res.sync_id, direction: "backup", status: "running", error: null, copied: [] });
    } else {
      setSaveSync({ sync_id: "", direction: "backup", status: "failed", error: res.error ?? "Failed to start backup", copied: [] });
    }
  };

  const handleRestoreSaves = async () => {
    if (!steamInfo) return;
    const res: SaveSyncRes = await syncSaves(game.name, selectedSource.source_id, "restore", steamInfo.unsigned_appid).catch((e) => ({ success: false, error: String(e) }));
    if (res.success && res.sync_id) {
      setSaveSync({ sync_id: res.sync_id, direction: "restore", status: "running", error: null, copied: [] });
    } else {
      setSaveSync({ sync_id: "", direction: "restore", status: "failed", error: res.error ?? "Failed to start restore", copied: [] });
    }
  };

  const handleCopySaves = async () => {
    if (!copySavesDest) return;
    setCopySavesConfirming(false);
    const dest = copySavesDest;
    setCopySavesDest(null);
    const res: SaveSyncRes = await copySavesBetweenSources(game.name, selectedSource.source_id, dest.source_id).catch((e) => ({ success: false, error: String(e) }));
    if (res.success && res.sync_id) {
      setSaveSync({ sync_id: res.sync_id, direction: "copy", status: "running", error: null, copied: [], to_source_id: dest.source_id });
    } else {
      setSaveSync({ sync_id: "", direction: "copy", status: "failed", error: res.error ?? "Failed to start copy", copied: [], to_source_id: dest.source_id });
    }
  };

  // ── Track nav view so Back restores to this game ──────────────────────────
  useEffect(() => {
    saveUiState({ view: "game-detail", game_name: game.name, source_id: selectedSource?.source_id, draft: null }).catch(() => {});
  }, [game.name, selectedSource?.source_id]);

  // ── Refs for auto-save (avoid stale closures without extra deps) ───────────
  const storedNameRef = useRef(storedName);
  useEffect(() => { storedNameRef.current = storedName; }, [storedName]);
  const selectedSourceIdRef = useRef(selectedSource?.source_id);
  useEffect(() => { selectedSourceIdRef.current = selectedSource?.source_id; }, [selectedSource?.source_id]);
  const canWriteRef = useRef(capabilities.can_write_config);
  useEffect(() => { canWriteRef.current = capabilities.can_write_config; }, [capabilities.can_write_config]);

  // ── Auto-save config on any field change (debounced 600ms) ────────────────
  useEffect(() => {
    const payload = {
      name, executable, start_dir: startDir || null, steam_app_id: steamAppId ?? null,
      proton_version: protonVersion || null, proton_dependencies: mergedDeps,
      proton_sync_paths: syncPaths, launch_options: launchOptions || null,
      selected_launchers: checkedLaunchers, collections: mergedCollections,
      steamgriddb_game_id: sgdbGameId ?? null,
    };
    if (JSON.stringify(payload) === JSON.stringify(configSnapshot)) return;
    const tid = setTimeout(async () => {
      if (!canWriteRef.current) return;
      try {
        const res = await updateGameConfig(storedNameRef.current, payload, selectedSourceIdRef.current!);
        if (res.success) {
          setStoredName(payload.name);
          setConfigSnapshot(payload);
        }
      } catch {}
    }, 600);
    return () => clearTimeout(tid);
  }, [name, executable, startDir, steamAppId, protonVersion, launchOptions, checkedLaunchers, checkedDeps, customDeps, checkedCollections, customCollections, syncPaths, sgdbGameId, configSnapshot]);

  // ── Fetch Deckyfin art options when Art Actions section opens ─────────────

  useEffect(() => {
    if (!showArtActions || sgdbGameId == null) return;
    setArtOptions([]);
    setArtOptionIdx(0);
    setArtGameId(null);
    setArtPage(0);
    setArtHasMore(false);
    setArtLoadedUrls(new Set());
    setArtOptionsLoading(true);
    fetchDeckyfinArtOptions(game.name, 0, sgdbGameId)
      .then((r) => {
        setArtOptions(r.urls || []);
        setArtGameId(r.game_id ?? null);
        setArtHasMore(r.has_more ?? false);
      })
      .catch(() => {})
      .finally(() => setArtOptionsLoading(false));
  }, [showArtActions, game.name, sgdbGameId]);

  // ── Fetch Steam art options when tab or Art Actions section changes ──────────

  useEffect(() => {
    if (!showArtActions || sgdbGameId == null) return;
    setSteamArtOptions([]);
    setSteamArtOptionIdx(0);
    setSteamArtPage(0);
    setSteamArtHasMore(false);
    setSteamArtLoadedUrls(new Set());
    setSteamArtOptionsLoading(true);
    fetchSteamArtOptions(sgdbGameId, steamArtTab, 0)
      .then((r) => {
        setSteamArtOptions(r.urls || []);
        setSteamArtHasMore(r.has_more ?? false);
      })
      .catch(() => {})
      .finally(() => setSteamArtOptionsLoading(false));
  }, [showArtActions, steamArtTab, sgdbGameId]);

  // ── Prefix file browser ───────────────────────────────────────────────────
  const pfxBrowseTo = async (path: string) => {
    setPfxBrowserLoading(true);
    try {
      const res = await listDirContents(path);
      setPfxBrowserPath(path);
      setPfxBrowserDirs(res.dirs);
      setPfxBrowserFiles(res.files);
    } catch {}
    setPfxBrowserLoading(false);
  };

  const handleTogglePrefixBrowser = async () => {
    if (showPrefixBrowser) {
      setShowPrefixBrowser(false);
      setPfxBrowseFeedback(null);
      return;
    }
    if (!steamInfo) {
      setPfxBrowseFeedback("Add game to Steam first.");
      return;
    }
    const root = await getGamePrefixPath(steamInfo.unsigned_appid).catch(() => null);
    if (!root) {
      setPfxBrowseFeedback("Prefix not initialized — run Init Prefix first.");
      return;
    }
    setPfxBrowseFeedback(null);
    setPrefixRoot(root);
    await pfxBrowseTo(root);
    setShowPrefixBrowser(true);
  };

  const handlePfxBrowserUp = () => {
    if (!prefixRoot || pfxBrowserPath === prefixRoot) return;
    const parent = pfxBrowserPath.substring(0, pfxBrowserPath.lastIndexOf("/")) || prefixRoot;
    pfxBrowseTo(parent.startsWith(prefixRoot) ? parent : prefixRoot);
  };

  const handlePfxBrowserEnter = (dir: string) => {
    pfxBrowseTo(`${pfxBrowserPath}/${dir}`);
  };

  // ── SGDB game picker ───────────────────────────────────────────────────
  const handleOpenSgdbPicker = async () => {
    if (showSgdbPicker) {
      setShowSgdbPicker(false);
      return;
    }
    setSgdbFeedback(null);
    setLoading("sgdb_search");
    try {
      const res = await searchSteamgridGames(name);
      setSgdbGames(res.games || []);
      setShowSgdbPicker(true);
    } catch {
      setSgdbGames([]);
      setShowSgdbPicker(true);
    }
    setLoading(null);
  };

  const handleSelectSgdbGame = (game: { id: number; name: string }) => {
    setSelectedSgdbGame(game);
    setSgdbGameId(game.id);
    setSgdbGameIdInput(String(game.id));
    setShowSgdbPicker(false);
  };

  const handleOpenSteamAppPicker = async () => {
    if (showSteamAppPicker) { setShowSteamAppPicker(false); return; }
    setLoading("steam_search");
    try {
      const res = await searchSteamApp(name);
      setSteamAppResults(res.results || []);
    } catch {
      setSteamAppResults([]);
    }
    setShowSteamAppPicker(true);
    setLoading(null);
  };

  const handleApplySgdbArt = async () => {
    if (sgdbGameId == null) return;
    setLoading("art");
    setSgdbFeedback(null);
    try {
      const artName = selectedSgdbGame?.id === sgdbGameId ? selectedSgdbGame.name : name;
      const { applied, errors } = await applyArtById(sgdbGameId, steamInfo!.unsigned_appid, artName);
      if (applied.length > 0) {
        setSgdbFeedback({ ok: true, msg: `Applied ${applied.join(", ")} art` });
      } else {
        setSgdbFeedback({ ok: false, msg: errors.join("; ") || "No art found" });
      }
    } catch (err: any) {
      setSgdbFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const STEAM_ART_ASSET_TYPE = {
    wide: AssetType.GRID_L,
    capsule: AssetType.GRID_P,
    hero: AssetType.HERO,
    logo: AssetType.LOGO,
    icon: AssetType.ICON,
  } as const;

  const goSteamArtPrev = () => setSteamArtOptionIdx((i) => (i - 1 + steamArtOptions.length) % steamArtOptions.length);
  const goSteamArtNext = () => {
    const next = (steamArtOptionIdx + 1) % steamArtOptions.length;
    setSteamArtOptionIdx(next);
    if (next === steamArtOptions.length - 1 && steamArtHasMore && !steamArtFetchingMore && sgdbGameId != null) {
      setSteamArtFetchingMore(true);
      fetchSteamArtOptions(sgdbGameId, steamArtTab, steamArtPage + 1)
        .then((r) => {
          setSteamArtOptions((prev) => [...prev, ...(r.urls || [])]);
          setSteamArtPage((p) => p + 1);
          setSteamArtHasMore(r.has_more ?? false);
        })
        .catch(() => {})
        .finally(() => setSteamArtFetchingMore(false));
    }
  };

  const handleApplySteamArtType = async () => {
    if (steamArtOptions.length === 0) return;
    setLoading("steam-art-type");
    setSgdbFeedback(null);
    try {
      const url = steamArtOptions[steamArtOptionIdx];
      const ok = await applyArtByType(steamInfo!.unsigned_appid, url, STEAM_ART_ASSET_TYPE[steamArtTab]);
      setSgdbFeedback(ok
        ? { ok: true, msg: `Applied ${steamArtTab} art to Steam` }
        : { ok: false, msg: `Failed to apply ${steamArtTab} art` });
    } catch (err: any) {
      setSgdbFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const goArtPrev = () => setArtOptionIdx((i) => (i - 1 + artOptions.length) % artOptions.length);
  const goArtNext = () => {
    const next = (artOptionIdx + 1) % artOptions.length;
    setArtOptionIdx(next);
    if (next === artOptions.length - 1 && artHasMore && !artFetchingMore && artGameId != null) {
      setArtFetchingMore(true);
      fetchDeckyfinArtOptions(game.name, artPage + 1, artGameId)
        .then((r) => {
          setArtOptions((prev) => [...prev, ...(r.urls || [])]);
          setArtPage((p) => p + 1);
          setArtHasMore(r.has_more ?? false);
        })
        .catch(() => {})
        .finally(() => setArtFetchingMore(false));
    }
  };

  const handleApplyDeckyfin = async (overrideUrl?: string) => {
    const url = overrideUrl ?? artOptions[artOptionIdx];
    if (!url) return;
    setLoading("deckyfin-art");
    setSgdbFeedback(null);
    try {
      const res = await applyDeckyfinArt(game.name, url);
      if (res.success) {
        setSgdbFeedback({ ok: true, msg: "Art applied — showing in plugin now" });
        getGameCardArt(game.name).then((r) => setHeaderArtUri(r.data_uri || null)).catch(() => {});
      } else {
        setSgdbFeedback({ ok: false, msg: res.error || "No art found" });
      }
    } catch (err: any) {
      setSgdbFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleApplyConfig = async () => {
    try {
      const payload = {
        name,
        executable,
        start_dir: startDir || null,
        steam_app_id: steamAppId ?? null,
        proton_version: protonVersion || null,
        proton_dependencies: mergedDeps,
        proton_sync_paths: syncPaths,
        launch_options: launchOptions || null,
        selected_launchers: checkedLaunchers,
        collections: mergedCollections,
        steamgriddb_game_id: sgdbGameId ?? null,
      };
      const res = await updateGameConfig(storedName, payload, selectedSource.source_id);
      if (!res.success) {
        setConfigFeedback({ ok: false, msg: "Failed to save config" });
      } else {
        setStoredName(name);
        setConfigFeedback({ ok: true, msg: "Config saved" });
        setConfigSnapshot(payload);
        // Immediately clear the draft so a sidebar close right after Apply Config
        // doesn't restore stale unsaved state
        saveUiState({ view: "game-detail", game_name: game.name, source_id: selectedSource.source_id, draft: null }).catch(() => {});
      }
    } catch (err: any) {
      setConfigFeedback({ ok: false, msg: err?.message || "Failed to save config" });
    }
  };

  // ── Executable picker ───────────────────────────────────────────────────
  const handleOpenExePicker = async () => {
    if (showExePicker) {
      setShowExePicker(false);
      return;
    }
    const root = currentConfig.path || game.name;
    try {
      const exes = await scanExes(root, selectedSource.source_id);
      setExeOptions(exes);
      setScanRoot(root);
      setShowExePicker(true);
    } catch {
      setFeedback({ ok: false, msg: "Failed to scan executables" });
    }
  };

  const handleSelectExe = (exe: string) => {
    const full = scanRoot ? `${scanRoot}/${exe}` : exe;
    setExecutable(full);
    const lastSlash = full.lastIndexOf("/");
    const dir = lastSlash > 0 ? full.substring(0, lastSlash) : full;
    setStartDir(dir);
    setShowExePicker(false);
  };

  // ── Action handlers ─────────────────────────────────────────────────────
  const handleAddToSteam = async () => {
    setLoading("add");
    setFeedback(null);
    try {
      const res = await addSteamShortcut(
        executable,
        name,
        startDir || undefined,
        finalLaunchOptions || "",
        protonVersion || undefined,
        mergedCollections.length > 0 ? mergedCollections : undefined,
        selectedSource.source_id
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setNeedsRestartAfterAdd(true);
        setNeedsRestart(true);
        setLastSyncedSnapshot({ name, executable, start_dir: startDir || null, launch_options: finalLaunchOptions || null, proton_version: protonVersion || null, collections: mergedCollections });
        updateGameConfig(storedName, { steam_snapshot: JSON.stringify({ name, executable, start_dir: startDir || null, launch_options: finalLaunchOptions || null, proton_version: protonVersion || null, collections: mergedCollections }), needs_restart_after_add: true, needs_restart: true }, selectedSource.source_id).catch(() => {});
        setFeedback({
          ok: true,
          msg: `Added to Steam (App ID: ${res.unsigned_appid}) — restart Steam to unlock actions`,
        });
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to add to Steam" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleUpdateSteam = async () => {
    setLoading("update");
    setFeedback(null);
    try {
      const res = await updateSteamShortcut(
        name,
        executable,
        startDir || undefined,
        finalLaunchOptions || "",
        protonVersion || undefined,
        mergedCollections.length > 0 ? mergedCollections : undefined,
        selectedSource.source_id
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setNeedsRestart(true);
        setLastSyncedSnapshot({ name, executable, start_dir: startDir || null, launch_options: finalLaunchOptions || null, proton_version: protonVersion || null, collections: mergedCollections });
        updateGameConfig(storedName, { steam_snapshot: JSON.stringify({ name, executable, start_dir: startDir || null, launch_options: finalLaunchOptions || null, proton_version: protonVersion || null, collections: mergedCollections }), needs_restart: true }, selectedSource.source_id).catch(() => {});
        setFeedback({
          ok: true,
          msg: "Steam updated — restart Steam to apply",
        });
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to update Steam shortcut" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleRemoveSteam = async () => {
    setLoading("remove");
    setFeedback(null);
    try {
      const res = await removeSteamShortcut(name);
      if (res.success) {
        setSteamInfo(null);
        setFeedback({ ok: true, msg: "Removed from Steam — restart Steam to apply" });
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Not found in Steam shortcuts" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handlePurgeSteam = async () => {
    setLoading("purge");
    setFeedback(null);
    try {
      const res = await purgeSteamGameData(name);
      if (res.success) {
        setSteamInfo(null);
        setFeedback({ ok: true, msg: "All Steam data purged — restart Steam to apply" });
        onNeedsRestart?.();
      } else {
        const detail = res.errors?.length ? res.errors.join("; ") : "Not found";
        setFeedback({ ok: false, msg: `Purge failed: ${detail}` });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleInitPrefix = async (reinit: boolean = false) => {
    if (needsRestartAfterAdd || !steamInfo) return;
    if (prefixInit?.status === "running") return;
    setShowReinitConfirm(false);
    setFeedback(null);
    try {
      const res = await initPrefix(
        steamInfo.app_id,
        protonVersion || undefined,
        reinit,
        game.name,
      );
      if (res.success && res.prefix_id) {
        setPrefixInit({ prefix_id: res.prefix_id, status: "running", error: null });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to start prefix init" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
  };

  const handleInitPrefixClick = async () => {
    if (needsRestartAfterAdd || !steamInfo) return;
    if (prefixInit?.status === "running") return;
    const checkPath = prefixRoot ?? await getGamePrefixPath(steamInfo.unsigned_appid).catch(() => null);
    if (checkPath) {
      try {
        const contents = await listDirContents(checkPath);
        if (contents.dirs.length > 0 || contents.files.length > 0) {
          setShowReinitConfirm(true);
          return;
        }
      } catch {}
    }
    handleInitPrefix(false);
  };

  const handleInstallDeps = async () => {
    if (needsRestartAfterAdd || !steamInfo || mergedDeps.length === 0) return;
    if (depInstall?.status === "installing") return;
    pendingDepsRef.current = mergedDeps;
    setDepInstall({ status: "installing", installed: [], failed_deps: [], error: null });
    try {
      const res = await startDepInstall(
        game.name,
        selectedSource.source_id,
        String(steamInfo.unsigned_appid),
        mergedDeps.join(", ")
      );
      if (!res.success) {
        setDepInstall({ status: "failed", installed: [], failed_deps: [], error: res.error || "Failed to start" });
      }
    } catch (err: any) {
      setDepInstall({ status: "failed", installed: [], failed_deps: [], error: err?.message || "Error" });
    }
  };


  const handleRemove = async () => {
    setFeedback(null);
    try {
      await removeGame(storedName, selectedSource.source_id);
      onBack();
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error removing game" });
    }
  };

  const handleRestartSteam = async () => {
    setRestarting(true);
    // Clear local state — the backend clears ALL per-game flags server-side
    setNeedsRestartAfterAdd(false);
    setNeedsRestart(false);
    try {
      await restartSteam();
    } catch (_) {
      // Steam will close this UI as part of the restart — errors here are expected
    }
    setRestarting(false);
  };

  // ── Detect unsaved config changes — drives Apply Config green state ──
  const configDirty = (() => {
    const current = {
      name,
      executable,
      start_dir: startDir || null,
      steam_app_id: steamAppId ?? null,
      proton_version: protonVersion || null,
      proton_dependencies: mergedDeps,
      proton_sync_paths: syncPaths,
      launch_options: launchOptions || null,
      selected_launchers: checkedLaunchers,
      collections: mergedCollections,
    };
    return JSON.stringify(current) !== JSON.stringify(configSnapshot);
  })();

  // ── Sync/install needed comparisons — drives green on action buttons ──
  const steamNeedsSync = (() => {
    if (!lastSyncedSnapshot) return true;
    const assembledLaunchOpts = buildLaunchOptions(
      configSnapshot.selected_launchers || [],
      popularLaunchersRef.current,
      configSnapshot.launch_options || "",
    );
    const a = lastSyncedSnapshot;
    const b = {
      name: configSnapshot.name,
      executable: configSnapshot.executable,
      start_dir: configSnapshot.start_dir,
      launch_options: assembledLaunchOpts || null,
      proton_version: configSnapshot.proton_version,
      collections: configSnapshot.collections,
    };
    return JSON.stringify(a) !== JSON.stringify(b);
  })();

  const depsNeedsInstall = mergedDeps.length > 0 && JSON.stringify(mergedDeps) !== JSON.stringify(lastInstalledDeps);

  const handleCopyConfig = async () => {
    if (!copyConfigDest) return;
    setCopyConfigConfirming(false);
    setCopyConfigFeedback(null);
    const dest = copyConfigDest;
    setCopyConfigDest(null);
    try {
      const res = await copyGameConfig(
        game.name,
        selectedSource.source_id,
        dest.source_id,
      );
      if (res.success && res.copy_id) {
        setConfigCopy({ copy_id: res.copy_id, status: "running", error: null });
      } else {
        setCopyConfigFeedback(`✗ ${res.error ?? "Failed"}`);
      }
    } catch (e) {
      setCopyConfigFeedback(`✗ ${String(e)}`);
    }
  };

  const handleStartTransfer = async () => {
    if (!copyGameDest) return;
    setCopyGameConfirming(false);
    setCopyGameFeedback(null);
    try {
      const res = await startGameTransfer(
        game.name,
        selectedSource.source_id,
        copyGameDest.id,
      );
      if (res.success && res.transfer_id) {
        setTransferId(res.transfer_id);
        setTransferStatus({
          transfer_id: res.transfer_id,
          game_name: game.name,
          from_source_id: selectedSource.source_id,
          to_source_id: copyGameDest.id,
          status: "running",
          bytes_copied: 0,
          total_bytes: 0,
          error: null,
        });
      } else {
        setCopyGameFeedback(`✗ ${res.error ?? "Failed to start transfer"}`);
      }
    } catch (e) {
      setCopyGameFeedback(`✗ ${String(e)}`);
    }
    setCopyGameDest(null);
  };

  const handleCancelOrDismissTransfer = async () => {
    if (transferId) await cancelTransfer(transferId).catch(() => {});
    setTransferId(null);
    setTransferStatus(null);
  };

  const handleRetryTransfer = async () => {
    if (!transferStatus) return;
    const { from_source_id, to_source_id } = transferStatus;
    setTransferStatus(null);
    setTransferId(null);
    try {
      const res = await startGameTransfer(game.name, from_source_id, to_source_id);
      if (res.success && res.transfer_id) {
        setTransferId(res.transfer_id);
        setTransferStatus({
          transfer_id: res.transfer_id,
          game_name: game.name,
          from_source_id,
          to_source_id,
          status: "running",
          bytes_copied: 0,
          total_bytes: 0,
          error: null,
        });
      }
    } catch (_) {}
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Focusable
      ref={rootRef}
      onCancel={onBack}
      onCancelButton={onBack}
      focusClassName="is-focused"
      style={{ padding: "8px" }}
    >
      {/* Back + source selector row */}
      <Focusable style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px" }} focusClassName="">
        <Focusable
          ref={backRef}
          onActivate={onBack}
          onClick={onBack}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, padding: "4px 10px" }}
        >
          Back
        </Focusable>

        {game.sources.length > 0 && (() => {
          const typeColor = selectedSource.source_type === "local" ? "#27ae60"
            : selectedSource.source_type === "mount" ? "#e67e22" : "#0984e3";
          const typeBg = selectedSource.source_type === "local" ? "#1a3a1a"
            : selectedSource.source_type === "mount" ? "#2a2a1a" : "#1a1a3a";
          return (
            <Focusable
              onActivate={() => setShowSourcePicker((p) => !p)}
              onClick={() => setShowSourcePicker((p) => !p)}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, padding: "4px 12px", borderColor: typeColor, color: typeColor, display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span style={{ padding: "1px 5px", fontSize: "0.75em", borderRadius: "8px", background: typeBg, border: `1px solid ${typeColor}` }}>
                {selectedSource.source_type}
              </span>
              {selectedSource.source_name}
              {(() => {
                const sz = sourceSizes[selectedSource.source_id];
                return (
                  <span style={{ color: "#888", fontSize: "0.85em", marginLeft: "4px" }}>
                    {sz === null ? "…" : sz > 0 ? `(${fmtBytes(sz)})` : ""}
                  </span>
                );
              })()}
              {game.sources.length > 1 ? " ▾" : ""}
            </Focusable>
          );
        })()}
      </Focusable>

      {/* Source picker dropdown */}
      {showSourcePicker && game.sources.length > 1 && (
        <Focusable style={{ marginBottom: "10px", border: "1px solid #555", borderRadius: "4px", padding: "2px 0" }}>
          {game.sources.map((src, idx) => (
            <Focusable
              key={src.source_id}
              onActivate={() => { setSelectedSourceIdx(idx); setShowSourcePicker(false); }}
              onClick={() => { setSelectedSourceIdx(idx); setShowSourcePicker(false); }}
              focusClassName="is-focused"
              style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333",
                color: idx === selectedSourceIdx ? "#0078d4" : "#ccc" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {src.source_name}
              {(() => {
                const sz = sourceSizes[src.source_id];
                return sz !== undefined && sz !== null && sz > 0 ? (
                  <span style={{ marginLeft: "5px", fontSize: "0.82em", color: "#888" }}>{fmtBytes(sz)}</span>
                ) : null;
              })()}
              <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.source_type})</span>
            </Focusable>
          ))}
        </Focusable>
      )}

      {/* ── Art header ──────────────────────────────────────────────────────── */}
      <div style={{ position: "relative", width: "100%", height: "110px", borderRadius: "6px", marginBottom: "8px", overflow: "hidden",
        background: headerArtUri ? `center / cover no-repeat url("${headerArtUri}")` : "linear-gradient(135deg, #667eea, #764ba2)" }}>
        {!headerArtUri && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", fontSize: "40px" }}>🎮</div>
        )}
        {steamInfo && (
          <div style={{ position: "absolute", bottom: "6px", right: "8px", display: "flex", alignItems: "center", gap: "4px",
            background: "rgba(0,0,0,0.55)", borderRadius: "6px", padding: "3px 7px" }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="#c7d5e0">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
            </svg>
            <span style={{ fontSize: "10px", color: "#c7d5e0" }}>Steam</span>
          </div>
        )}
      </div>

      {/* ── Metadata ──────────────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowMetadata((v) => !v)} onClick={() => setShowMetadata((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showMetadata ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Metadata</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showMetadata ? "▲" : "▼"}</span>
        </Focusable>
        {showMetadata && (
          <div style={{ padding: "8px 12px", borderTop: "1px solid #2a2a2a" }}>
            {([
              ["Name", name],
              ["Executable", executable],
              ["Start Dir", startDir || "—"],
              ["Proton Version", protonVersion || "— (Steam default)"],
              ["Dependencies", mergedDeps.length > 0 ? mergedDeps.join(", ") : "—"],
              ["Collections", mergedCollections.length > 0 ? mergedCollections.join(", ") : "—"],
              ["Save Paths", syncPaths.length > 0 ? syncPaths.join(", ") : "—"],
              ["Steam App ID", steamAppId != null ? String(steamAppId) : "—"],
              ["SteamGridDB ID", sgdbGameId != null ? String(sgdbGameId) : "—"],
              ["Shortcut App ID", steamInfo ? String(steamInfo.unsigned_appid) : "—"],
              ["On Steam", steamInfo ? "Yes" : "No"],
              ["Source", `${selectedSource.source_name} (${selectedSource.source_type})`],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "0.82em" }}>
                <span style={{ color: "#666", minWidth: "110px", flexShrink: 0 }}>{label}</span>
                <span style={{ color: "#c0c0c0", wordBreak: "break-all", flex: 1 }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Game Settings ────────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowGameSettings((v) => !v)} onClick={() => setShowGameSettings((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showGameSettings ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Game Settings</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showGameSettings ? "▲" : "▼"}</span>
        </Focusable>
        {showGameSettings && (
          <div style={{ padding: "8px 12px", borderTop: "1px solid #2a2a2a" }}>
            {/* Name */}
            <label style={{ fontSize: "0.78em", color: "#888", display: "block", marginBottom: "2px" }}>Name</label>
            <CompactTextField value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
            {/* Executable */}
            <label style={{ fontSize: "0.78em", color: "#888", display: "block", marginBottom: "2px" }}>Executable</label>
            <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: showExePicker ? "6px" : "8px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CompactTextField value={executable} onChange={(e) => setExecutable(e.target.value)} style={{ width: "100%" }} />
              </div>
              <Focusable onActivate={handleOpenExePicker} onClick={handleOpenExePicker} focusClassName="is-focused" style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px" }}>
                {showExePicker ? "✕" : "Browse"}
              </Focusable>
            </Focusable>
            {showExePicker && (
              <Focusable style={{ border: "1px solid #555", borderRadius: "4px", maxHeight: "180px", overflowY: "auto", padding: "2px 0", marginBottom: "8px" }}>
                {exeOptions.length === 0 && <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>No executables found in {startDir}</p>}
                {exeOptions.map((exe) => (
                  <Focusable key={exe} onActivate={() => handleSelectExe(exe)} onClick={() => handleSelectExe(exe)} focusClassName="is-focused"
                    style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    {exe}
                  </Focusable>
                ))}
              </Focusable>
            )}
            {/* Start Dir */}
            <label style={{ fontSize: "0.78em", color: "#888", display: "block", marginBottom: "2px" }}>Start Dir</label>
            <CompactTextField value={startDir} onChange={(e) => setStartDir(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
            {/* Steam App ID */}
            <Focusable focusClassName="" style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
              <span style={{ fontSize: "0.78em", color: "#888" }}>Steam App ID</span>
              <Focusable focusClassName="is-focused"
                onActivate={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.steamdb.info/app/${steamAppId}/` : `https://www.steamdb.info/search/?a=all&q=${encodeURIComponent(name)}`)}
                onClick={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.steamdb.info/app/${steamAppId}/` : `https://www.steamdb.info/search/?a=all&q=${encodeURIComponent(name)}`)}
                style={{ padding: "1px 4px", fontSize: "0.65em", borderRadius: "12px", border: "1px solid #555", color: "#888", cursor: "pointer", lineHeight: 1 }}>
                ℹ
              </Focusable>
            </Focusable>
            <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: showSteamAppPicker ? "4px" : "8px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CompactTextField
                  value={steamAppIdInput}
                  onChange={(e) => { setSteamAppIdInput(e.target.value); const p = parseInt(e.target.value, 10); setSteamAppId(isNaN(p) ? undefined : p); }}
                  style={{ width: "100%" }}
                />
              </div>
              <Focusable onActivate={handleOpenSteamAppPicker} onClick={handleOpenSteamAppPicker} focusClassName="is-focused"
                style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px", opacity: loading === "steam_search" ? 0.5 : 1 }}>
                {loading === "steam_search" ? "…" : showSteamAppPicker ? "✕" : "Search"}
              </Focusable>
            </Focusable>
            {showSteamAppPicker && (
              <Focusable style={{ border: "1px solid #555", borderRadius: "4px", maxHeight: "160px", overflowY: "auto", padding: "2px 0", marginBottom: "8px" }}>
                {steamAppResults.length === 0 && (
                  <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>No results found for "{name}"</p>
                )}
                {steamAppResults.map((r) => (
                  <Focusable key={r.id} onActivate={() => { setSteamAppId(r.id); setSteamAppIdInput(String(r.id)); setShowSteamAppPicker(false); }}
                    onClick={() => { setSteamAppId(r.id); setSteamAppIdInput(String(r.id)); setShowSteamAppPicker(false); }}
                    focusClassName="is-focused"
                    style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: steamAppId === r.id ? "#0078d4" : "#ccc" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    {r.name}
                    <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({r.id})</span>
                  </Focusable>
                ))}
              </Focusable>
            )}
            {/* SteamGridDB */}
            <Focusable focusClassName="" style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "2px" }}>
              <span style={{ fontSize: "0.78em", color: "#888" }}>SteamGridDB Game ID</span>
              <Focusable focusClassName="is-focused"
                onActivate={() => Navigation.NavigateToExternalWeb(sgdbGameId != null ? `https://www.steamgriddb.com/game/${sgdbGameId}` : `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(name)}`)}
                onClick={() => Navigation.NavigateToExternalWeb(sgdbGameId != null ? `https://www.steamgriddb.com/game/${sgdbGameId}` : `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(name)}`)}
                style={{ padding: "1px 4px", fontSize: "0.65em", borderRadius: "12px", border: "1px solid #555", color: "#888", cursor: "pointer", lineHeight: 1 }}>
                ℹ
              </Focusable>
            </Focusable>
            <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: showSgdbPicker ? "4px" : "8px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CompactTextField
                  value={sgdbGameIdInput}
                  onChange={(e) => { setSgdbGameIdInput(e.target.value); const p = parseInt(e.target.value, 10); setSgdbGameId(isNaN(p) ? null : p); setSelectedSgdbGame(null); }}
                  style={{ width: "100%" }}
                />
              </div>
              <Focusable onActivate={handleOpenSgdbPicker} onClick={handleOpenSgdbPicker} focusClassName="is-focused"
                style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px", opacity: loading === "sgdb_search" ? 0.5 : 1 }}>
                {loading === "sgdb_search" ? "…" : showSgdbPicker ? "✕" : "Search"}
              </Focusable>
            </Focusable>
            {showSgdbPicker && (
              <Focusable style={{ border: "1px solid #555", borderRadius: "4px", maxHeight: "160px", overflowY: "auto", padding: "2px 0" }}>
                {sgdbGames.length === 0 && (
                  <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>No results for "{name}"</p>
                )}
                {sgdbGames.map((g) => (
                  <Focusable key={g.id} onActivate={() => handleSelectSgdbGame(g)} onClick={() => handleSelectSgdbGame(g)} focusClassName="is-focused"
                    style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333",
                      color: selectedSgdbGame?.id === g.id ? "#0078d4" : "#ccc" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    {g.name} <span style={{ fontSize: "0.78em", color: "#666" }}>({g.id})</span>
                  </Focusable>
                ))}
              </Focusable>
            )}
          </div>
        )}
      </div>

      {/* Launch Options */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowLaunchOptions((v) => !v)} onClick={() => setShowLaunchOptions((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showLaunchOptions ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Launch Options</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showLaunchOptions ? "▲" : "▼"}</span>
        </Focusable>
        {showLaunchOptions && (
          <div style={{ padding: "8px" }}>
            <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
              Wrapper scripts and extra flags passed to the launch command. Toggle common wrappers like GameMode or MangoHUD, or type raw arguments directly. Check{" "}
              <Focusable
                onActivate={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.protondb.com/app/${steamAppId}` : `https://www.protondb.com/search?q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                onClick={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.protondb.com/app/${steamAppId}` : `https://www.protondb.com/search?q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>
                ProtonDB
              </Focusable>{" "}for community launch flag recommendations.
              {onNavigateToSettings && <>{" "}To add more popular options, go to{" "}<Focusable onActivate={onNavigateToSettings} onClick={onNavigateToSettings} focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>Settings → Popular Launcher Options</Focusable>.</>}
            </p>
            {popularLaunchers.length > 0 && (
              <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                {popularLaunchers.map((pl) => {
                  const active = checkedLaunchers.includes(pl.label);
                  return (
                    <Focusable key={pl.label} onActivate={() => toggleCheckedLauncher(pl.label)} onClick={() => toggleCheckedLauncher(pl.label)} focusClassName="is-focused"
                      style={{ margin: "0 2px", padding: "4px 10px", borderRadius: "12px", fontSize: "0.82em", cursor: "pointer",
                        border: active ? "1px solid #0078d4" : "1px solid #555", background: active ? "#0078d4" : "transparent", color: active ? "white" : "#ccc" }}>
                      {pl.label}
                    </Focusable>
                  );
                })}
              </Focusable>
            )}
            <CompactTextField value={launchOptions} onChange={(e) => setLaunchOptions(e.target.value)} placeholder="Extra launch options…"
              style={{ width: "100%", marginBottom: finalLaunchOptions ? "6px" : "0" }} />
            {finalLaunchOptions && <div style={{ fontSize: "0.75em", color: "#555", wordBreak: "break-all" as const, marginTop: "4px" }}>→ {finalLaunchOptions}</div>}
          </div>
        )}
      </div>

      {/* Collections */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowCollections((v) => !v)} onClick={() => setShowCollections((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showCollections ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Collections</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showCollections ? "▲" : "▼"}</span>
        </Focusable>
        {showCollections && (
          <div style={{ padding: "8px" }}>
            <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
              Assign this game to Steam collections for library organisation. Select from your existing collections or add custom ones below.
              {onNavigateToSettings && <>{" "}To create or delete collections, go to{" "}<Focusable onActivate={onNavigateToSettings} onClick={onNavigateToSettings} focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", textDecoration: "underline" }}>Settings → Steam Collections</Focusable>.</>}
            </p>
            {steamCollections.length > 0 && (
              <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {steamCollections.map((col) => {
                  const selected = checkedCollections.includes(col);
                  return (
                    <Focusable key={col} onActivate={() => toggleCheckedCollection(col)} onClick={() => toggleCheckedCollection(col)} focusClassName="is-focused"
                      style={{ padding: "4px 12px", fontSize: "0.82em", borderRadius: "14px", cursor: "pointer",
                        border: selected ? "1px solid #0078d4" : "1px solid #555", background: selected ? "#0078d4" : "transparent", color: selected ? "white" : "#ccc" }}>
                      {col}
                    </Focusable>
                  );
                })}
              </Focusable>
            )}
            <label style={{ fontSize: "0.82em", color: "#888", display: "block", marginBottom: "2px" }}>Custom (comma-separated)</label>
            <CompactTextField value={customCollections} onChange={(e) => setCustomCollections(e.target.value)}
              placeholder={steamCollections.length > 0 ? "e.g. RPG, FPS" : "e.g. RPG, FPS, Favorites"} style={{ width: "100%" }} />
          </div>
        )}
      </div>

      {/* Proton Version */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowProtonVersion((v) => !v)} onClick={() => setShowProtonVersion((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showProtonVersion ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Proton Version</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showProtonVersion ? "▲" : "▼"}</span>
        </Focusable>
        {showProtonVersion && (
          <>
            <div style={{ padding: "8px 12px 4px", borderBottom: "1px solid #2a2a2a" }}>
              <p style={{ fontSize: "0.78em", color: "#888", margin: 0, lineHeight: 1.5 }}>
                The Proton/Wine build used to run this game. Leave blank to use Steam's default. Check{" "}
                <Focusable
                  onActivate={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.protondb.com/app/${steamAppId}` : `https://www.protondb.com/search?q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                  onClick={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://www.protondb.com/app/${steamAppId}` : `https://www.protondb.com/search?q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                  focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>
                  ProtonDB
                </Focusable>{" "}for community-tested recommendations.
                {onNavigateToSettings && <>{" "}To download additional Proton builds, go to{" "}<Focusable onActivate={onNavigateToSettings} onClick={onNavigateToSettings} focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>Settings → Proton Versions</Focusable>.</>}
              </p>
            </div>
            <div style={{ padding: "2px 0", maxHeight: "200px", overflowY: "auto" }}>
              <Focusable onActivate={() => { setProtonVersion(""); setShowProtonVersion(false); }} onClick={() => { setProtonVersion(""); setShowProtonVersion(false); }} focusClassName="is-focused"
                style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #2a2a2a", color: !protonVersion ? "#0078d4" : "#ccc" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                — None —
              </Focusable>
              {protonVersions.map((v) => (
                <Focusable key={v} onActivate={() => { setProtonVersion(v); setShowProtonVersion(false); }} onClick={() => { setProtonVersion(v); setShowProtonVersion(false); }} focusClassName="is-focused"
                  style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #2a2a2a", color: protonVersion === v ? "#0078d4" : "#ccc" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  {v}
                </Focusable>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Dependencies */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowDependencies((v) => !v)} onClick={() => setShowDependencies((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showDependencies ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Dependencies</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showDependencies ? "▲" : "▼"}</span>
        </Focusable>
        {showDependencies && (
          <div style={{ padding: "8px" }}>
            <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
              Winetricks packages installed into this game's Proton prefix — DirectX, Visual C++ runtimes, and other Windows libraries. Look up requirements on{" "}
              <Focusable
                onActivate={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://steamdb.info/app/${steamAppId}/` : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                onClick={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://steamdb.info/app/${steamAppId}/` : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
                focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>
                SteamDB
              </Focusable>.
              {onNavigateToSettings && <>{" "}To add more popular dependency chips, go to{" "}<Focusable onActivate={onNavigateToSettings} onClick={onNavigateToSettings} focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>Settings → Popular Dependencies</Focusable>.</>}
            </p>
            <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
              {popularDeps.map((dep) => {
                const selected = checkedDeps.includes(dep);
                return (
                  <Focusable key={dep} onActivate={() => toggleCheckedDep(dep)} onClick={() => toggleCheckedDep(dep)} focusClassName="is-focused"
                    style={{ padding: "4px 12px", fontSize: "0.82em", borderRadius: "14px", cursor: "pointer",
                      border: selected ? "1px solid #0078d4" : "1px solid #555", background: selected ? "#0078d4" : "transparent", color: selected ? "white" : "#ccc" }}>
                    {dep}
                  </Focusable>
                );
              })}
            </Focusable>
            <label style={{ fontSize: "0.82em", color: "#888", display: "block", marginBottom: "2px" }}>Custom (comma-separated)</label>
            <CompactTextField value={customDeps} onChange={(e) => setCustomDeps(e.target.value)} style={{ width: "100%" }} />
          </div>
        )}
      </div>

      {/* Save Paths */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowSavePaths((v) => !v)} onClick={() => setShowSavePaths((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showSavePaths ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Save Paths</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showSavePaths ? "▲" : "▼"}</span>
        </Focusable>
        {showSavePaths && <div style={{ padding: "8px" }}>
          <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
            Paths inside the Proton prefix to back up and restore saves. Select a prefix location and type the game-specific subfolder. Look up the correct path on{" "}
            <Focusable onActivate={() => Navigation.NavigateToExternalWeb(`https://www.pcgamingwiki.com/wiki/Special:Search?search=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
              onClick={() => Navigation.NavigateToExternalWeb(`https://www.pcgamingwiki.com/wiki/Special:Search?search=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
              focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>
              PCGamingWiki
            </Focusable>{" "}or{" "}
            <Focusable onActivate={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://steamdb.info/app/${steamAppId}/` : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
              onClick={() => Navigation.NavigateToExternalWeb(steamAppId ? `https://steamdb.info/app/${steamAppId}/` : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`)}
              focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>
              SteamDB
            </Focusable>.
            {onNavigateToSettings && <>{" "}To add custom prefix shortcuts, go to{" "}<Focusable onActivate={onNavigateToSettings} onClick={onNavigateToSettings} focusClassName="is-focused" style={{ display: "inline", color: "#5dade2", cursor: "pointer", background: "transparent", border: "none", padding: 0, fontSize: "inherit" }}>Settings → Popular Save Prefixes</Focusable>.</>}
          </p>
          {syncPaths.length > 0 && (
            <div style={{ marginBottom: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {syncPaths.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.06)", border: "1px solid #3a3a3a", borderRadius: "4px", padding: "4px 8px" }}>
                  <span style={{ flex: 1, fontSize: "0.78em", color: "#c0c0c0", fontFamily: "monospace", wordBreak: "break-all" }}>{p}</span>
                  <Focusable onActivate={() => setSyncPaths((prev) => prev.filter((_, j) => j !== i))} onClick={() => setSyncPaths((prev) => prev.filter((_, j) => j !== i))} focusClassName="is-focused"
                    style={{ cursor: "pointer", color: "#666", padding: "0 4px", flexShrink: 0, fontSize: "0.85em" }}>✕</Focusable>
                </div>
              ))}
            </div>
          )}
          {(() => {
            const PREFIXES = [
              { label: "Roaming", path: "drive_c/users/steamuser/AppData/Roaming" },
              { label: "LocalLow", path: "drive_c/users/steamuser/AppData/LocalLow" },
              { label: "Local", path: "drive_c/users/steamuser/AppData/Local" },
              { label: "My Documents", path: "drive_c/users/steamuser/My Documents" },
              { label: "My Games", path: "drive_c/users/steamuser/My Documents/My Games" },
              { label: "Saved Games", path: "drive_c/users/steamuser/Saved Games" },
              { label: "Game Folder", path: "game://" },
              { label: "Userdata", path: "userdata://" },
              ...customSavePrefixes.filter((cp) => !["Roaming","LocalLow","Local","My Documents","My Games","Saved Games","Game Folder","Userdata","Custom"].includes(cp.label)),
              { label: "Custom", path: "" },
            ];
            const activePfx = PREFIXES.find((p) => p.label === selectedPfx) ?? PREFIXES[0];
            const isScheme = activePfx.path === "game://" || activePfx.path === "userdata://";
            const fullPath = isScheme ? `${activePfx.path}${syncSuffix.trim()}` : activePfx.path ? `${activePfx.path}/${syncSuffix.trim()}`.replace(/\/$/, "") : syncSuffix.trim();
            const canAdd = syncSuffix.trim().length > 0;
            const handleAdd = () => { if (canAdd) { setSyncPaths((prev) => [...prev, fullPath]); setSyncSuffix(""); } };
            return (
              <>
                <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
                  {PREFIXES.map((pfx) => {
                    const active = selectedPfx === pfx.label;
                    return (
                      <Focusable key={pfx.label} onActivate={() => setSelectedPfx(pfx.label)} onClick={() => setSelectedPfx(pfx.label)} focusClassName="is-focused"
                        style={{ padding: "3px 9px", fontSize: "0.75em", borderRadius: "10px", cursor: "pointer",
                          border: active ? "1px solid #0078d4" : "1px solid #555", background: active ? "rgba(0,120,212,0.2)" : "transparent", color: active ? "#5dade2" : "#aaa" }}>
                        {pfx.label}
                      </Focusable>
                    );
                  })}
                </Focusable>
                {activePfx.path && (
                  <div style={{ fontSize: "0.72em", color: "#555", marginBottom: "4px", fontFamily: "monospace", wordBreak: "break-all" }}>
                    {activePfx.path === "game://" ? "[game folder]/" : activePfx.path === "userdata://" ? "[steam userdata]/" : `${activePfx.path}/`}
                  </div>
                )}
                <Focusable focusClassName="" style={{ display: "flex", gap: "6px" }}>
                  <div style={{ flex: 1 }}>
                    <CompactTextField value={syncSuffix} onChange={(e) => setSyncSuffix(e.target.value)}
                      placeholder={activePfx.path === "game://" ? "CULTIC_Data/Saves" : activePfx.path === "userdata://" ? "<app_id>/remote" : activePfx.path ? "GameName/saves" : "drive_c/users/steamuser/..."}
                      style={{ width: "100%" }} />
                  </div>
                  <Focusable onActivate={handleAdd} onClick={handleAdd} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, padding: "4px 10px", fontSize: "0.82em", opacity: canAdd ? 1 : 0.4 }}>
                    Add
                  </Focusable>
                </Focusable>
              </>
            );
          })()}
        </div>}
      </div>

      {/* ── Steam Actions ──────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowSteamActions((v) => !v)} onClick={() => setShowSteamActions((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showSteamActions ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Steam Actions</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {((capabilities.can_play && steamNeedsSync) || needsRestart) && (
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#2ecc71", display: "inline-block", flexShrink: 0 }} />
            )}
            <span style={{ fontSize: "0.78em", color: "#666" }}>{showSteamActions ? "▲" : "▼"}</span>
          </div>
        </Focusable>
        {showSteamActions && (
          <div style={{ padding: "8px" }}>
            <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
              Sync this game's settings to Steam and restart Steam to apply changes. Add the game as a non-Steam shortcut so it appears in your library, or update an existing shortcut after editing its settings.
            </p>
            {needsRestartAfterAdd && (
              <div style={{ padding: "8px 12px", marginBottom: "8px", borderRadius: "4px", background: "rgba(230,126,34,0.15)", border: "1px solid rgba(230,126,34,0.3)", fontSize: "0.82em", color: "#e67e22" }}>
                ⚠ Restart Steam to unlock prefix and art actions
              </div>
            )}
            {!capabilities.can_play && (
              <div style={{ padding: "8px 10px", borderRadius: "4px", background: "rgba(52,73,94,0.3)", border: "1px solid #2c3e50", fontSize: "0.78em", color: "#7f8c8d", marginBottom: "8px" }}>
                🔒 Steam actions unavailable — games on {selectedSource.source_type} sources can't be launched by Steam
              </div>
            )}
            <Focusable
              onActivate={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
              onClick={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px",
                opacity: !capabilities.can_play || loading === "add" || loading === "update" ? 0.4 : 1,
                border: capabilities.can_play && steamNeedsSync ? "1px solid #27ae60" : "1px solid #555",
                color: capabilities.can_play && steamNeedsSync ? "#2ecc71" : "#e0e0e0" }}>
              {loading === "add" ? "Adding…" : loading === "update" ? "Updating…" : steamInfo ? "Update Steam Game" : "Add to Steam"}
            </Focusable>
            <Focusable
              onActivate={runningTaskCount > 0 ? undefined : handleRestartSteam}
              onClick={runningTaskCount > 0 ? undefined : handleRestartSteam}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const,
                border: runningTaskCount > 0 ? "1px solid #444" : needsRestart ? "1px solid #27ae60" : "1px solid #555",
                color: runningTaskCount > 0 ? "#555" : needsRestart ? "#2ecc71" : "#e0e0e0",
                opacity: runningTaskCount > 0 ? 0.5 : 1,
                cursor: runningTaskCount > 0 ? "default" : "pointer" }}>
              {restarting ? "…" : runningTaskCount > 0 ? `↺ Restart Steam (${runningTaskCount} task${runningTaskCount > 1 ? "s" : ""} running)` : "↺ Restart Steam"}
            </Focusable>
            {feedback && <p style={{ marginTop: "8px", color: feedback.ok ? "lightgreen" : "tomato", fontSize: "0.9em" }}>{feedback.msg}</p>}
          </div>
        )}
      </div>

      {/* ── Prefix Actions ─────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable onActivate={() => setShowPrefixActions((v) => !v)} onClick={() => setShowPrefixActions((v) => !v)} focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showPrefixActions ? "6px 6px 0 0" : "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Prefix Actions</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {capabilities.can_play && depsNeedsInstall && (
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#2ecc71", display: "inline-block", flexShrink: 0 }} />
            )}
            <span style={{ fontSize: "0.78em", color: "#666" }}>{showPrefixActions ? "▲" : "▼"}</span>
          </div>
        </Focusable>
        {showPrefixActions && (
          <div style={{ padding: "8px" }}>
            <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
              Manage the Wine/Proton prefix for this game. Initialize it to create a fresh Windows environment, install required dependencies, or browse the prefix filesystem to inspect or locate files.
            </p>
            {!steamInfo && !needsRestartAfterAdd && capabilities.can_play && (
              <div style={{ padding: "8px 10px", borderRadius: "4px", background: "rgba(52,73,94,0.3)", border: "1px solid #2c3e50", fontSize: "0.78em", color: "#7f8c8d", marginBottom: "8px" }}>
                🔒 Add game to Steam first
              </div>
            )}
            {needsRestartAfterAdd && (
              <div style={{ padding: "8px 12px", marginBottom: "8px", borderRadius: "4px", background: "rgba(230,126,34,0.15)", border: "1px solid rgba(230,126,34,0.3)", fontSize: "0.82em", color: "#e67e22" }}>
                ⚠ Restart Steam to unlock prefix actions
              </div>
            )}
            {!capabilities.can_play && (
              <div style={{ padding: "8px 10px", borderRadius: "4px", background: "rgba(52,73,94,0.3)", border: "1px solid #2c3e50", fontSize: "0.78em", color: "#7f8c8d", marginBottom: "8px" }}>
                🔒 Prefix actions unavailable — games on {selectedSource.source_type} sources can't be launched by Steam
              </div>
            )}
            {/* Init Prefix */}
            <Focusable
              onActivate={capabilities.can_play ? handleInitPrefixClick : undefined}
              onClick={capabilities.can_play ? handleInitPrefixClick : undefined}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: showReinitConfirm ? "4px" : "6px",
                opacity: !capabilities.can_play || !steamInfo || needsRestartAfterAdd || prefixInit?.status === "running" ? 0.4 : 1 }}>
              {prefixInit?.status === "running" ? "Initing…" : "Init Prefix"}
            </Focusable>
            {showReinitConfirm && (
              <div style={{ fontSize: "0.82em", color: "#ccc", marginBottom: "6px", padding: "6px 8px", background: "#1a1a1a", borderRadius: "4px", border: "1px solid #444" }}>
                <div style={{ marginBottom: "6px" }}>Prefix already exists. Re-initialize? This will wipe the current prefix.</div>
                <Focusable focusClassName="" style={{ display: "flex", gap: "6px" }}>
                  <Focusable onActivate={() => setShowReinitConfirm(false)} onClick={() => setShowReinitConfirm(false)} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
                  <Focusable onActivate={() => handleInitPrefix(true)} onClick={() => handleInitPrefix(true)} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", border: "1px solid #e74c3c", color: "#e74c3c" }}>Yes, Re-initialize</Focusable>
                </Focusable>
              </div>
            )}
            {/* Install Dependencies */}
            <Focusable
              onActivate={capabilities.can_play ? handleInstallDeps : undefined}
              onClick={capabilities.can_play ? handleInstallDeps : undefined}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px",
                opacity: !capabilities.can_play || !steamInfo || needsRestartAfterAdd || mergedDeps.length === 0 || depInstall?.status === "installing" ? 0.4 : 1,
                border: capabilities.can_play && depsNeedsInstall ? "1px solid #27ae60" : "1px solid #555",
                color: capabilities.can_play && depsNeedsInstall ? "#2ecc71" : "#e0e0e0" }}>
              {depInstall?.status === "installing" ? "Installing…" : "Install Dependencies"}
            </Focusable>
            {/* Browse Prefix Files */}
            <Focusable
              onActivate={handleTogglePrefixBrowser}
              onClick={handleTogglePrefixBrowser}
              focusClassName="is-focused"
              style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px",
                opacity: !steamInfo ? 0.4 : 1 }}>
              {showPrefixBrowser ? "✕ Close Browser" : "Browse Prefix Files"}
            </Focusable>
            {pfxBrowseFeedback && (
              <div style={{ fontSize: "0.82em", color: "#e67e22", marginBottom: "6px" }}>{pfxBrowseFeedback}</div>
            )}
            {showPrefixBrowser && (
              <>
                <div style={{ fontSize: "0.78em", color: "#555", marginBottom: "4px", borderRadius: "4px", padding: "3px 8px", background: "#1a1a1a" }}>
                  {steamInfo ? `App ID: ${steamInfo.unsigned_appid}` : ""}
                </div>
                <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", padding: "5px 8px", border: "1px solid #2a2a2a", borderRadius: "4px 4px 0 0", background: "#1a1a1a" }}>
                  <Focusable onActivate={handlePfxBrowserUp} onClick={handlePfxBrowserUp} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.78em", opacity: pfxBrowserPath === prefixRoot ? 0.3 : 1 }}>
                    ← Up
                  </Focusable>
                  <span style={{ flex: 1, fontSize: "0.72em", color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
                    {pfxBrowserPath}
                  </span>
                </Focusable>
                <Focusable focusClassName="" style={{ maxHeight: "200px", overflowY: "auto", padding: "2px 0", border: "1px solid #2a2a2a", borderTop: "none", borderRadius: "0 0 4px 4px", marginBottom: "6px" }}>
                  {pfxBrowserLoading && <p style={{ padding: "8px", margin: 0, fontSize: "0.82em", color: "#888" }}>Loading…</p>}
                  {!pfxBrowserLoading && pfxBrowserDirs.length === 0 && pfxBrowserFiles.length === 0 && (
                    <p style={{ padding: "8px", margin: 0, fontSize: "0.82em", color: "#555" }}>Empty</p>
                  )}
                  {!pfxBrowserLoading && pfxBrowserDirs.map((dir) => (
                    <Focusable key={`d:${dir}`} onActivate={() => handlePfxBrowserEnter(dir)} onClick={() => handlePfxBrowserEnter(dir)} focusClassName="is-focused"
                      style={{ margin: "0 2px", padding: "4px 10px", fontSize: "0.82em", cursor: "pointer", borderBottom: "1px solid #2a2a2a" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      📁 {dir}
                    </Focusable>
                  ))}
                  {!pfxBrowserLoading && pfxBrowserFiles.map((file) => (
                    <Focusable key={`f:${file}`} onActivate={() => {}} focusClassName="is-focused"
                      style={{ margin: "0 2px", padding: "4px 10px", fontSize: "0.82em", color: "#666", borderBottom: "1px solid #2a2a2a" }}>
                      📄 {file}
                    </Focusable>
                  ))}
                </Focusable>
              </>
            )}
            {/* Dep install status */}
            {depInstall && (
              <div style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginTop: "4px", background: "#1a1a1a", fontSize: "0.82em" }}>
                {depInstall.status === "installing" && <span style={{ color: "#aaa" }}>⟳ Installing dependencies — you can navigate away and come back</span>}
                {depInstall.status === "done" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#2ecc71" }}>✓ Installed: {(depInstall.installed || []).join(", ") || "done"}</span>
                    <Focusable onActivate={() => setDepInstall(null)} onClick={() => setDepInstall(null)} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                  </div>
                )}
                {depInstall.status === "failed" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "tomato" }}>✗ {depInstall.error || (depInstall.failed_deps?.length ? `Failed: ${depInstall.failed_deps.join(", ")}` : "Installation failed")}</span>
                    <Focusable onActivate={() => setDepInstall(null)} onClick={() => setDepInstall(null)} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                  </div>
                )}
              </div>
            )}
            {/* Prefix init status */}
            {prefixInit && (
              <div style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginTop: "4px", background: "#1a1a1a", fontSize: "0.82em" }}>
                {prefixInit.status === "running" && <span style={{ color: "#aaa" }}>⟳ Initializing prefix — you can navigate away and come back</span>}
                {prefixInit.status === "done" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#2ecc71" }}>✓ Prefix initialized</span>
                    <Focusable onActivate={() => { setPrefixInit(null); clearPrefixInitStatus(prefixInit.prefix_id).catch(() => {}); }} onClick={() => { setPrefixInit(null); clearPrefixInitStatus(prefixInit.prefix_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                  </div>
                )}
                {prefixInit.status === "failed" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ {prefixInit.error || "Prefix init failed"}</span>
                    <Focusable onActivate={() => { setPrefixInit(null); clearPrefixInitStatus(prefixInit.prefix_id).catch(() => {}); }} onClick={() => { setPrefixInit(null); clearPrefixInitStatus(prefixInit.prefix_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}>✕</Focusable>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Art Actions ────────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
          <Focusable onActivate={() => setShowArtActions((v) => !v)} onClick={() => setShowArtActions((v) => !v)} focusClassName="is-focused"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showArtActions ? "6px 6px 0 0" : "6px" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Art Actions</span>
            <span style={{ fontSize: "0.78em", color: "#666" }}>{showArtActions ? "▲" : "▼"}</span>
          </Focusable>
          {showArtActions && (
            <div style={{ padding: "8px" }}>
              <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
                Apply artwork to this game. Apply Deckyfin Art fetches art from{" "}
                <span
                  style={{ color: "#51cbf8", cursor: "pointer", textDecoration: "underline" }}
                  onClick={() => Navigation.NavigateToExternalWeb(sgdbGameId != null ? `https://www.steamgriddb.com/game/${sgdbGameId}` : `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(name)}`)}
                >
                  SteamGridDB
                </span>
                {" "}and displays it immediately in the plugin's game card and game page — no Steam restart needed, works before adding to Steam. Apply Steam Art uses Steam's native API to push art into Steam's own UI and requires the game to be added to Steam first.
              </p>
              {/* ── Steam Art picker ── */}
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: "8px", marginBottom: "8px" }}>
                <div style={{ fontSize: "0.78em", color: "#aaa", marginBottom: "6px", fontWeight: 600 }}>Steam Art</div>
                {sgdbGameId == null ? (
                  <div style={{ fontSize: "0.78em", color: "#555", padding: "8px 0", marginBottom: "6px" }}>
                    Set a SteamGridDB ID in Game Settings to browse Steam art options.
                  </div>
                ) : (
                  <>
                    {/* Type tabs — row 1: Wide/Capsule/Hero, row 2: Logo/Icon centered */}
                    {(() => {
                      const tabStyle = (tab: typeof steamArtTab): React.CSSProperties => ({
                        ...BTN_STYLE, flex: 1, textAlign: "center", padding: "3px 0", margin: "0 2px", fontSize: "0.78em",
                        background: steamArtTab === tab ? "rgba(81,203,248,0.15)" : undefined,
                        borderColor: steamArtTab === tab ? "#51cbf8" : undefined,
                        color: steamArtTab === tab ? "#51cbf8" : undefined,
                      });
                      const tabLabel = { wide: "Wide", capsule: "Capsule", hero: "Hero", logo: "Logo", icon: "Icon" };
                      return (
                        <div style={{ marginBottom: "8px" }}>
                          <Focusable focusClassName="" style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
                            {(["wide", "capsule", "hero"] as const).map((tab) => (
                              <Focusable key={tab} onActivate={() => setSteamArtTab(tab)} onClick={() => setSteamArtTab(tab)} focusClassName="is-focused" style={tabStyle(tab)}>
                                {tabLabel[tab]}
                              </Focusable>
                            ))}
                          </Focusable>
                          <Focusable focusClassName="" style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                            {(["logo", "icon"] as const).map((tab) => (
                              <Focusable key={tab} onActivate={() => setSteamArtTab(tab)} onClick={() => setSteamArtTab(tab)} focusClassName="is-focused" style={{ ...tabStyle(tab), flex: "0 0 calc(33.33% - 2px)" }}>
                                {tabLabel[tab]}
                              </Focusable>
                            ))}
                          </Focusable>
                        </div>
                      );
                    })()}
                    {steamArtOptionsLoading && (
                      <div style={{ textAlign: "center", fontSize: "0.82em", color: "#888", padding: "12px 0" }}>Loading…</div>
                    )}
                    {!steamArtOptionsLoading && steamArtOptions.length > 0 && (() => {
                      const useContain = steamArtTab === "logo" || steamArtTab === "capsule" || steamArtTab === "icon";
                      const containerStyle: React.CSSProperties = steamArtTab === "wide"
                        ? { position: "relative", width: "100%", paddingBottom: "46.7%", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" }
                        : steamArtTab === "capsule"
                        ? { position: "relative", width: "100%", height: "280px", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" }
                        : steamArtTab === "hero"
                        ? { position: "relative", width: "100%", paddingBottom: "32.3%", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" }
                        : steamArtTab === "icon"
                        ? { position: "relative", width: "100%", height: "100px", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" }
                        : { position: "relative", width: "100%", height: "90px", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" };
                      const currentUrl = steamArtOptions[steamArtOptionIdx];
                      return (
                        <div style={{ marginBottom: "6px" }}>
                          <div style={containerStyle}>
                            <img
                              src={currentUrl}
                              onLoad={() => setSteamArtLoadedUrls((prev) => new Set(prev).add(currentUrl))}
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: useContain ? "contain" : "cover" }}
                            />
                            {!steamArtLoadedUrls.has(currentUrl) && (
                              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
                                <span style={{ fontSize: "1.4em", color: "#aaa" }}>⟳</span>
                              </div>
                            )}
                          </div>
                          <Focusable focusClassName="" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <Focusable onActivate={goSteamArtPrev} onClick={goSteamArtPrev} focusClassName="is-focused" style={{ ...BTN_STYLE, flex: "0 0 auto", padding: "4px 10px", margin: "0 2px" }}>‹</Focusable>
                            <span style={{ flex: 1, textAlign: "center", fontSize: "0.78em", color: "#888" }}>{steamArtOptionIdx + 1}</span>
                            <Focusable onActivate={goSteamArtNext} onClick={goSteamArtNext} focusClassName="is-focused" style={{ ...BTN_STYLE, flex: "0 0 auto", padding: "4px 10px", margin: "0 2px" }}>›</Focusable>
                          </Focusable>
                        </div>
                      );
                    })()}
                    {!steamArtOptionsLoading && steamArtOptions.length === 0 && (
                      <div style={{ textAlign: "center", fontSize: "0.82em", color: "#555", padding: "8px 0" }}>
                        No {steamArtTab} art found on SteamGridDB
                      </div>
                    )}
                    <Focusable
                      onActivate={steamArtOptions.length > 0 ? handleApplySteamArtType : undefined}
                      onClick={steamArtOptions.length > 0 ? handleApplySteamArtType : undefined}
                      focusClassName="is-focused"
                      style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "4px",
                        opacity: steamArtOptions.length === 0 || loading === "steam-art-type" ? 0.4 : 1 }}>
                      {loading === "steam-art-type" ? "Applying…" : `Apply ${steamArtTab === "wide" ? "Wide" : steamArtTab === "capsule" ? "Capsule" : steamArtTab === "hero" ? "Hero" : steamArtTab === "logo" ? "Logo" : "Icon"} Art`}
                    </Focusable>
                    <Focusable
                      onActivate={sgdbGameId != null ? handleApplySgdbArt : undefined}
                      onClick={sgdbGameId != null ? handleApplySgdbArt : undefined}
                      focusClassName="is-focused"
                      style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "4px",
                        opacity: loading === "art" ? 0.4 : 1 }}>
                      {loading === "art" ? "Applying…" : "Auto Apply All Steam Art"}
                    </Focusable>
                  </>
                )}
              </div>

              {/* ── Deckyfin Art picker ── */}
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: "8px" }}>
                <div style={{ fontSize: "0.78em", color: "#aaa", marginBottom: "6px", fontWeight: 600 }}>Deckyfin Art</div>
                {sgdbGameId == null ? (
                  <div style={{ fontSize: "0.78em", color: "#555", padding: "8px 0", marginBottom: "6px" }}>
                    Set a SteamGridDB ID in Game Settings to browse art options.
                  </div>
                ) : <>
                {artOptionsLoading && (
                  <div style={{ textAlign: "center", fontSize: "0.82em", color: "#888", padding: "12px 0" }}>
                    Loading…
                  </div>
                )}
                {!artOptionsLoading && artOptions.length > 0 && (
                  <div style={{ marginBottom: "8px" }}>
                    <div style={{ position: "relative", width: "100%", paddingBottom: "46.5%", marginBottom: "6px", borderRadius: "4px", overflow: "hidden", background: "#111" }}>
                      <img
                        src={artOptions[artOptionIdx]}
                        onLoad={() => setArtLoadedUrls((prev) => new Set(prev).add(artOptions[artOptionIdx]))}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      {!artLoadedUrls.has(artOptions[artOptionIdx]) && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
                          <span style={{ fontSize: "1.4em", color: "#aaa" }}>⟳</span>
                        </div>
                      )}
                    </div>
                    <Focusable focusClassName="" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Focusable onActivate={goArtPrev} onClick={goArtPrev} focusClassName="is-focused" style={{ ...BTN_STYLE, flex: "0 0 auto", padding: "4px 10px", margin: "0 2px" }}>‹</Focusable>
                      <span style={{ flex: 1, textAlign: "center", fontSize: "0.78em", color: "#888" }}>{artOptionIdx + 1}</span>
                      <Focusable onActivate={goArtNext} onClick={goArtNext} focusClassName="is-focused" style={{ ...BTN_STYLE, flex: "0 0 auto", padding: "4px 10px", margin: "0 2px" }}>›</Focusable>
                    </Focusable>
                  </div>
                )}
                {!artOptionsLoading && artOptions.length === 0 && (
                  <div style={{ textAlign: "center", fontSize: "0.82em", color: "#555", padding: "8px 0", marginBottom: "6px" }}>
                    No art options found on SteamGridDB
                  </div>
                )}
                <Focusable
                  onActivate={capabilities.can_play && artOptions.length > 0 ? () => handleApplyDeckyfin() : undefined}
                  onClick={capabilities.can_play && artOptions.length > 0 ? () => handleApplyDeckyfin() : undefined}
                  focusClassName="is-focused"
                  style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "4px",
                    opacity: loading === "deckyfin-art" || artOptions.length === 0 ? 0.4 : 1 }}>
                  {loading === "deckyfin-art" ? "Applying…" : "Apply Deckyfin Art"}
                </Focusable>
                <Focusable
                  onActivate={capabilities.can_play && artOptions.length > 0 ? () => handleApplyDeckyfin(artOptions[0]) : undefined}
                  onClick={capabilities.can_play && artOptions.length > 0 ? () => handleApplyDeckyfin(artOptions[0]) : undefined}
                  focusClassName="is-focused"
                  style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const,
                    opacity: loading === "deckyfin-art" || artOptions.length === 0 ? 0.4 : 1 }}>
                  {loading === "deckyfin-art" ? "Applying…" : "Auto Apply Deckyfin Art"}
                </Focusable>
                </>}
              </div>
              {sgdbFeedback && (
                <div style={{ fontSize: "0.82em", marginTop: "6px", color: sgdbFeedback.ok ? "#2ecc71" : "tomato", wordBreak: "break-word", overflowWrap: "break-word" }}>
                  {sgdbFeedback.msg}
                </div>
              )}
            </div>
          )}
        </div>

      {/* ── Transfer Actions ──────────────────────────────────────────────── */}
      {(game.sources.length >= 2 ||
        allSources.some(
          (s) =>
            s.type !== "agent" &&
            !game.sources.some((gs) => gs.source_id === s.id),
        ) ||
        (game.sources.length >= 2 && syncPaths.length > 0)) && (
        <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
          <Focusable
            onActivate={() => setShowTransferActions((v) => !v)}
            onClick={() => setShowTransferActions((v) => !v)}
            focusClassName="is-focused"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showTransferActions ? "6px 6px 0 0" : "6px" }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Transfer Actions</span>
            <span style={{ fontSize: "0.78em", color: "#666" }}>{showTransferActions ? "▲" : "▼"}</span>
          </Focusable>
          {showTransferActions && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid #2a2a2a" }}>
          <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
            Copy this game or its settings between sources. Copy Game transfers the game files to another location, Copy Config replicates its Deckyfin configuration to another source, and Copy Saves moves save data between sources.
          </p>
          {/* Copy game block */}
          {allSources.some((s) => s.type !== "agent" && !game.sources.some((gs) => gs.source_id === s.id)) && (
            <div style={{ marginBottom: "6px" }}>
              <Focusable
                onActivate={() => {
                  setShowCopyGamePicker((v) => !v);
                  setShowCopyConfigPicker(false);
                  setCopyGameDest(null);
                  setCopyGameConfirming(false);
                }}
                onClick={() => {
                  setShowCopyGamePicker((v) => !v);
                  setShowCopyConfigPicker(false);
                  setCopyGameDest(null);
                  setCopyGameConfirming(false);
                }}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px" }}
              >
                {copyGameDest ? `Copy Game → ${copyGameDest.name}` : "Copy Game"}
              </Focusable>

              {showCopyGamePicker && !copyGameConfirming && (
                <div style={{ border: "1px solid #555", borderRadius: "4px", padding: "2px 0", marginTop: "4px" }}>
                  {allSources
                    .filter((s) => s.type !== "agent" && !game.sources.some((gs) => gs.source_id === s.id))
                    .map((src) => (
                      <Focusable
                        key={src.id}
                        onActivate={() => { setCopyGameDest(src); setShowCopyGamePicker(false); setCopyGameConfirming(true); }}
                        onClick={() => { setCopyGameDest(src); setShowCopyGamePicker(false); setCopyGameConfirming(true); }}
                        focusClassName="is-focused"
                        style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: "#ccc" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {src.name}
                        <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.type})</span>
                      </Focusable>
                    ))}
                </div>
              )}

              {copyGameConfirming && copyGameDest && (
                <div style={{ fontSize: "0.82em", color: "#ccc", marginTop: "4px" }}>
                  <span>Copy <b>{game.name}</b> to <b>{copyGameDest.name}</b>?</span>
                  <Focusable focusClassName="" style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <Focusable onActivate={() => { setCopyGameConfirming(false); setCopyGameDest(null); }} onClick={() => { setCopyGameConfirming(false); setCopyGameDest(null); }} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
                    <Focusable onActivate={handleStartTransfer} onClick={handleStartTransfer} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", border: "1px solid #27ae60", color: "#2ecc71" }}>Copy</Focusable>
                  </Focusable>
                </div>
              )}

              {copyGameFeedback && (
                <p style={{ margin: "4px 0 0", fontSize: "0.82em", color: "tomato" }}>
                  {copyGameFeedback}
                </p>
              )}
            </div>
          )}

          {/* Copy config block */}
          {game.sources.length >= 2 && (
            <div style={{ marginBottom: "6px" }}>
              <Focusable
                onActivate={() => {
                  setShowCopyConfigPicker((v) => !v);
                  setShowCopyGamePicker(false);
                  setCopyConfigDest(null);
                  setCopyConfigConfirming(false);
                }}
                onClick={() => {
                  setShowCopyConfigPicker((v) => !v);
                  setShowCopyGamePicker(false);
                  setCopyConfigDest(null);
                  setCopyConfigConfirming(false);
                }}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px" }}
              >
                {copyConfigDest ? `Copy Config → ${copyConfigDest.source_name}` : "Copy Config"}
              </Focusable>

              {showCopyConfigPicker && !copyConfigConfirming && (
                <div style={{ border: "1px solid #555", borderRadius: "4px", padding: "2px 0", marginTop: "4px" }}>
                  {game.sources
                    .filter((s) => s.source_id !== selectedSource.source_id)
                    .map((src) => (
                      <Focusable
                        key={src.source_id}
                        onActivate={() => { setCopyConfigDest(src); setShowCopyConfigPicker(false); setCopyConfigConfirming(true); }}
                        onClick={() => { setCopyConfigDest(src); setShowCopyConfigPicker(false); setCopyConfigConfirming(true); }}
                        focusClassName="is-focused"
                        style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: "#ccc" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {src.source_name}
                        <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.source_type})</span>
                      </Focusable>
                    ))}
                </div>
              )}

              {copyConfigConfirming && copyConfigDest && (
                <div style={{ fontSize: "0.82em", color: "#ccc", marginTop: "4px" }}>
                  <span>Replace <b>{copyConfigDest.source_name}</b>'s config with <b>{selectedSource.source_name}</b>'s?</span>
                  <Focusable focusClassName="" style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <Focusable onActivate={() => { setCopyConfigConfirming(false); setCopyConfigDest(null); }} onClick={() => { setCopyConfigConfirming(false); setCopyConfigDest(null); }} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
                    <Focusable onActivate={handleCopyConfig} onClick={handleCopyConfig} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", border: "1px solid #27ae60", color: "#2ecc71" }}>Copy</Focusable>
                  </Focusable>
                </div>
              )}

              {copyConfigFeedback && (
                <p style={{ margin: "4px 0 0", fontSize: "0.82em", color: copyConfigFeedback.startsWith("✓") ? "#2ecc71" : "tomato" }}>
                  {copyConfigFeedback}
                </p>
              )}
            </div>
          )}

          {/* Copy saves block */}
          {game.sources.length >= 2 && syncPaths.length > 0 && (
            <div style={{ marginBottom: "6px" }}>
              <Focusable
                onActivate={() => { setShowCopySavesPicker((v) => !v); setCopySavesDest(null); setCopySavesConfirming(false); }}
                onClick={() => { setShowCopySavesPicker((v) => !v); setCopySavesDest(null); setCopySavesConfirming(false); }}
                focusClassName="is-focused"
                style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px" }}>
                {copySavesDest ? `Copy Saves → ${copySavesDest.source_name}` : "Copy Saves"}
              </Focusable>
              {showCopySavesPicker && !copySavesConfirming && (
                <div style={{ border: "1px solid #555", borderRadius: "4px", padding: "2px 0", marginTop: "4px" }}>
                  {game.sources.filter((s) => s.source_id !== selectedSource.source_id).map((src) => (
                    <Focusable key={src.source_id}
                      onActivate={() => { setCopySavesDest(src); setShowCopySavesPicker(false); setCopySavesConfirming(true); }}
                      onClick={() => { setCopySavesDest(src); setShowCopySavesPicker(false); setCopySavesConfirming(true); }}
                      focusClassName="is-focused"
                      style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: "#ccc" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      {src.source_name}
                      <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.source_type})</span>
                    </Focusable>
                  ))}
                </div>
              )}
              {copySavesConfirming && copySavesDest && (
                <div style={{ fontSize: "0.82em", color: "#ccc", marginTop: "4px" }}>
                  <span>Copy saves from <b>{selectedSource.source_name}</b> → <b>{copySavesDest.source_name}</b>?</span>
                  <Focusable focusClassName="" style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <Focusable onActivate={() => { setCopySavesConfirming(false); setCopySavesDest(null); }} onClick={() => { setCopySavesConfirming(false); setCopySavesDest(null); }} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
                    <Focusable onActivate={handleCopySaves} onClick={handleCopySaves} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", border: "1px solid #27ae60", color: "#2ecc71" }}>Copy</Focusable>
                  </Focusable>
                </div>
              )}
            </div>
          )}

          {/* ── Transfer Progress Banner ───────────────────────────────────────── */}
          {transferStatus && (() => {
            const pct =
              transferStatus.total_bytes > 0
                ? Math.round((transferStatus.bytes_copied / transferStatus.total_bytes) * 100)
                : 0;
            const destName =
              allSources.find((s) => s.id === transferStatus.to_source_id)?.name ??
              transferStatus.to_source_id;
            return (
              <div
                style={{
                  border: "1px solid #444",
                  borderRadius: "4px",
                  padding: "8px 10px",
                  marginTop: "10px",
                  background: "#1a1a1a",
                  fontSize: "0.82em",
                }}
              >
                {transferStatus.status === "queued" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#888" }}>⏳ Queued — waiting to copy to {destName}…</span>
                    <Focusable
                      onActivate={handleCancelOrDismissTransfer}
                      onClick={handleCancelOrDismissTransfer}
                      focusClassName="is-focused"
                      style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                    >
                      ✕
                    </Focusable>
                  </div>
                )}
                {transferStatus.status === "running" && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "4px",
                      }}
                    >
                      <span>
                        ▸ Copying to {destName}… {pct}%
                      </span>
                      <Focusable
                        onActivate={handleCancelOrDismissTransfer}
                        onClick={handleCancelOrDismissTransfer}
                        focusClassName="is-focused"
                        style={{ cursor: "pointer", color: "#888", fontSize: "0.9em", padding: "0 6px", border: "1px solid #555", borderRadius: "3px" }}
                      >
                        Cancel
                      </Focusable>
                    </div>
                    <div
                      style={{ background: "#333", borderRadius: "2px", height: "4px", marginBottom: "3px" }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          background: "#0078d4",
                          borderRadius: "2px",
                          height: "100%",
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <span style={{ color: "#666" }}>
                      {fmtBytes(transferStatus.bytes_copied)} / {fmtBytes(transferStatus.total_bytes)}
                    </span>
                  </>
                )}
                {transferStatus.status === "done" && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#2ecc71" }}>
                      ✓ Copy complete — go back to refresh the game list
                    </span>
                    <Focusable
                      onActivate={handleCancelOrDismissTransfer}
                      onClick={handleCancelOrDismissTransfer}
                      focusClassName="is-focused"
                      style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                    >
                      ✕
                    </Focusable>
                  </div>
                )}
                {transferStatus.status === "failed" && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "8px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ color: "tomato" }}>
                      ✗ {transferStatus.error ?? "Transfer failed"}
                    </span>
                    <Focusable focusClassName="" style={{ display: "flex", gap: "4px" }}>
                      <Focusable
                        onActivate={handleRetryTransfer}
                        onClick={handleRetryTransfer}
                        focusClassName="is-focused"
                        style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}
                      >
                        Retry
                      </Focusable>
                      <Focusable
                        onActivate={handleCancelOrDismissTransfer}
                        onClick={handleCancelOrDismissTransfer}
                        focusClassName="is-focused"
                        style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                      >
                        ✕
                      </Focusable>
                    </Focusable>
                  </div>
                )}
              </div>
            );
          })()}
          {/* Config copy status */}
          {configCopy && (
            <div style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginTop: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
              {configCopy.status === "running" && <span style={{ color: "#aaa" }}>⟳ Copying config…</span>}
              {configCopy.status === "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2ecc71" }}>✓ Config copied</span>
                  <Focusable onActivate={() => { setConfigCopy(null); clearConfigCopyStatus(configCopy.copy_id).catch(() => {}); }} onClick={() => { setConfigCopy(null); clearConfigCopyStatus(configCopy.copy_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {configCopy.status === "failed" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ {configCopy.error || "Config copy failed"}</span>
                  <Focusable onActivate={() => { setConfigCopy(null); clearConfigCopyStatus(configCopy.copy_id).catch(() => {}); }} onClick={() => { setConfigCopy(null); clearConfigCopyStatus(configCopy.copy_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}>✕</Focusable>
                </div>
              )}
            </div>
          )}
            </div>
          )}
        </div>
      )}

      {/* ── Save Actions ───────────────────────────────────────────────────── */}
      {syncPaths.length > 0 && (capabilities.can_write_config || !!steamInfo) && (
        <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
          <Focusable onActivate={() => setShowSaveActions((v) => !v)} onClick={() => setShowSaveActions((v) => !v)} focusClassName="is-focused"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showSaveActions ? "6px 6px 0 0" : "6px" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>Save Actions</span>
            <span style={{ fontSize: "0.78em", color: "#666" }}>{showSaveActions ? "▲" : "▼"}</span>
          </Focusable>
          {showSaveActions && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid #2a2a2a" }}>
              <p style={{ fontSize: "0.78em", color: "#888", margin: "0 0 8px 0", lineHeight: 1.5 }}>
                Back up and restore save files for this game. Backup copies saves from the Proton prefix to a safe folder; Restore brings them back. Save paths are configured in the Save Paths section above.
              </p>
              {/* Backup / Restore */}
              {capabilities.can_write_config && steamInfo && (
                <>
                  <Focusable onActivate={handleBackupSaves} onClick={handleBackupSaves} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px", opacity: saveSync?.status === "running" ? 0.4 : 1 }}>
                    ↑ Backup Saves
                  </Focusable>
                  <Focusable onActivate={handleRestoreSaves} onClick={handleRestoreSaves} focusClassName="is-focused"
                    style={{ ...BTN_STYLE, display: "block", width: "100%", boxSizing: "border-box" as const, textAlign: "center" as const, marginBottom: "6px", opacity: saveSync?.status === "running" ? 0.4 : 1 }}>
                    ↓ Restore Saves
                  </Focusable>
                </>
              )}
              {/* Save sync status */}
              {saveSync && (
                <div style={{ border: "1px solid #444", borderRadius: "4px", padding: "5px 8px", background: "#1a1a1a", fontSize: "0.82em" }}>
                  {saveSync.status === "running" && <span style={{ color: "#aaa" }}>⟳ {saveSync.direction === "backup" ? "Backing up" : saveSync.direction === "restore" ? "Restoring" : "Copying"} saves…</span>}
                  {saveSync.status === "done" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#2ecc71" }}>✓ {saveSync.direction === "backup" ? "Saves backed up" : saveSync.direction === "restore" ? "Saves restored" : "Saves copied"}{saveSync.copied?.length ? ` (${saveSync.copied.length})` : ""}</span>
                        <Focusable onActivate={() => { if (saveSync.sync_id) clearSaveSyncStatus(saveSync.sync_id).catch(() => {}); setSaveSync(null); }} onClick={() => { if (saveSync.sync_id) clearSaveSyncStatus(saveSync.sync_id).catch(() => {}); setSaveSync(null); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px" }}>✕</Focusable>
                      </div>
                      {saveSync.saves_dir && saveSync.direction === "backup" && (
                        <div style={{ fontSize: "0.72em", color: "#555", fontFamily: "monospace", wordBreak: "break-all", marginTop: "3px" }}>{saveSync.saves_dir}</div>
                      )}
                    </div>
                  )}
                  {saveSync.status === "failed" && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                      <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ {saveSync.error ?? "Save sync failed"}</span>
                      <Focusable onActivate={() => { if (saveSync.sync_id) clearSaveSyncStatus(saveSync.sync_id).catch(() => {}); setSaveSync(null); }} onClick={() => { if (saveSync.sync_id) clearSaveSyncStatus(saveSync.sync_id).catch(() => {}); setSaveSync(null); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px" }}>✕</Focusable>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "8px" }}>
        <Focusable
          onActivate={() => setShowDangerZone((v) => !v)}
          onClick={() => setShowDangerZone((v) => !v)}
          focusClassName="is-focused"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e", borderRadius: showDangerZone ? "6px 6px 0 0" : "6px" }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e74c3c" }}>Danger Zone</span>
          <span style={{ fontSize: "0.78em", color: "#666" }}>{showDangerZone ? "▲" : "▼"}</span>
        </Focusable>
        {showDangerZone && (
          <div style={{ padding: "8px 12px", borderTop: "1px solid #2a2a2a" }}>

      {steamInfo && (
        <div>
          {confirming === "steam" ? (
            <div
              style={{
                border: "1px solid #c0392b",
                borderRadius: "4px",
                padding: "10px",
                marginBottom: "8px",
                textAlign: "center",
                fontSize: "0.85em",
                color: "#e74c3c",
              }}
            >
              <div style={{ marginBottom: "6px" }}>Remove from Steam?</div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <Focusable
                  onActivate={() => { setConfirming(null); handleRemoveSteam(); }}
                  onClick={() => { setConfirming(null); handleRemoveSteam(); }}
                  focusClassName="is-focused"
                  style={{
                    ...BTN_STYLE,
                    border: "1px solid #c0392b",
                    background: "#c0392b",
                    color: "white",
                  }}
                >
                  Yes, Remove
                </Focusable>
                <Focusable
                  onActivate={() => setConfirming(null)}
                  onClick={() => setConfirming(null)}
                  focusClassName="is-focused"
                  style={BTN_STYLE}
                >
                  Cancel
                </Focusable>
              </div>
            </div>
          ) : (
            <Focusable
              onActivate={() => setConfirming("steam")}
              onClick={() => setConfirming("steam")}
              focusClassName="is-focused"
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "0.85em",
                cursor: "pointer",
                borderRadius: "4px",
                border: "1px solid #c0392b",
                background: "transparent",
                color: "#e74c3c",
                marginBottom: "8px",
                textAlign: "center",
                opacity: loading === "remove" ? 0.5 : 1,
              }}
            >
              {loading === "remove" ? "Removing…" : "Remove from Steam"}
            </Focusable>
          )}
        </div>
      )}

      {/* ── Purge All Steam Data ────────────────────────────────────────── */}
      {steamInfo && (
        <div>
          {confirming === "purge" ? (
            <div
              style={{
                border: "1px solid #c0392b",
                borderRadius: "4px",
                padding: "10px",
                marginBottom: "8px",
                textAlign: "center",
                fontSize: "0.85em",
                color: "#e74c3c",
              }}
            >
              <div style={{ marginBottom: "6px" }}>
                Purge all Steam data for this game? This removes the shortcut,
                prefix, config, and grid art. Cannot be undone.
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <Focusable
                  onActivate={() => { setConfirming(null); handlePurgeSteam(); }}
                  onClick={() => { setConfirming(null); handlePurgeSteam(); }}
                  focusClassName="is-focused"
                  style={{
                    ...BTN_STYLE,
                    border: "1px solid #c0392b",
                    background: "#c0392b",
                    color: "white",
                  }}
                >
                  Yes, Purge Everything
                </Focusable>
                <Focusable
                  onActivate={() => setConfirming(null)}
                  onClick={() => setConfirming(null)}
                  focusClassName="is-focused"
                  style={BTN_STYLE}
                >
                  Cancel
                </Focusable>
              </div>
            </div>
          ) : (
            <Focusable
              onActivate={() => setConfirming("purge")}
              onClick={() => setConfirming("purge")}
              focusClassName="is-focused"
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "0.85em",
                cursor: "pointer",
                borderRadius: "4px",
                border: "1px solid #c0392b",
                background: "transparent",
                color: "#e74c3c",
                marginBottom: "8px",
                textAlign: "center",
                opacity: loading === "purge" ? 0.5 : 1,
              }}
            >
              {loading === "purge" ? "Purging…" : "Purge All Steam Data"}
            </Focusable>
          )}
        </div>
      )}

      {confirming === "deckyfin" ? (
        <div
          style={{
            border: "1px solid #c0392b",
            borderRadius: "4px",
            padding: "12px",
            textAlign: "center",
            fontSize: "0.85em",
            color: "#e74c3c",
          }}
        >
          <div style={{ marginBottom: "6px" }}>Remove game from source? This will delete the game folder and its config. Cannot be undone.</div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
            <Focusable
              onActivate={() => { setConfirming(null); handleRemove(); }}
              onClick={() => { setConfirming(null); handleRemove(); }}
              focusClassName="is-focused"
              style={{
                ...BTN_STYLE,
                border: "1px solid #c0392b",
                background: "#c0392b",
                color: "white",
              }}
            >
              Yes, Remove
            </Focusable>
            <Focusable
              onActivate={() => setConfirming(null)}
              onClick={() => setConfirming(null)}
              focusClassName="is-focused"
              style={BTN_STYLE}
            >
              Cancel
            </Focusable>
          </div>
        </div>
      ) : (
        <Focusable
          onActivate={() => setConfirming("deckyfin")}
          onClick={() => setConfirming("deckyfin")}
          focusClassName="is-focused"
          style={{
            width: "100%",
            padding: "12px 0",
            fontSize: "0.85em",
            cursor: "pointer",
            borderRadius: "4px",
            border: "1px solid #c0392b",
            background: "transparent",
            color: "#e74c3c",
            textAlign: "center",
          }}
        >
          Remove Game from Source
        </Focusable>
      )}

          </div>
        )}
      </div>

    </Focusable>
  );
};
