import { VFC, useState, useEffect, useRef } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { GameConfig, MergedGame, GameSource, SourceCapabilities } from "../types";
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
  [app_id: number, proton_name?: string, reinitialize?: boolean],
  { success: boolean; error?: string }
>("init_prefix");
const installDeps = callable<
  [pfxid: string, dependencies: string],
  { success: boolean; installed?: string[]; failed?: string[]; error?: string }
>("install_dependencies");
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
  { success: boolean; error?: string }
>("copy_game_config");
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

/** Popular Proton dependencies shown as toggle chips. */
const POPULAR_DEPS = [
  "vcrun2022",
  "vcrun2019",
  "vcrun2013",
  "vcrun2010",
  "vcrun2008",
  "d3dx9",
  "d3dx10",
  "d3dx11",
  "d3dcompiler_47",
  "dotnet48",
  "dotnet40",
  "dotnet35sp1",
  "dotnet20",
  "physx",
  "mfplat",
  "xna",
  "dwrite",
  "corefonts",
];

interface Props {
  game: MergedGame;
  onBack: () => void;
  onNeedsRestart?: () => void;
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

export const GameDetail: VFC<Props> = ({ game, onBack, onNeedsRestart }) => {
  // ── Refs ─────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus Back button on mount so B-button works immediately ──
  useEffect(() => {
    const timer = setTimeout(() => backRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // ── Source selector ────────────────────────────────────────────────────────
  const [selectedSourceIdx, setSelectedSourceIdx] = useState(0);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [capabilities, setCapabilities] = useState<SourceCapabilities>({
    can_play: true,
    can_write_config: true,
    can_download_to: true,
  });

  // ── All sources (for game copy destination picker) ────────────────────
  const [allSources, setAllSources] = useState<import("../types").Source[]>([]);

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
    currentConfig.steam_app_id !== undefined ? String(currentConfig.steam_app_id) : ""
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

  // ── Dependencies: checkboxes + custom ────────────────────────────────────
  const existingDeps = currentConfig.proton_dependencies || [];
  const [checkedDeps, setCheckedDeps] = useState<string[]>(
    existingDeps.filter((d) => POPULAR_DEPS.includes(d))
  );
  const [customDeps, setCustomDeps] = useState<string>(
    existingDeps
      .filter((d) => !POPULAR_DEPS.includes(d))
      .join(", ")
  );

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
  const [forceReinit, setForceReinit] = useState(false);
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
    launch_options: currentConfig.launch_options || null,
    collections: currentConfig.collections || [],
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

  // ── Proton versions ─────────────────────────────────────────────────────
  const [protonVersions, setProtonVersions] = useState<string[]>([]);

  // ── Artwork ───────────────────────────────────────────────────────────────
  const { applyArtById } = useArtwork();

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
    setSteamAppIdInput(currentConfig.steam_app_id !== undefined ? String(currentConfig.steam_app_id) : "");
    setProtonVersion(currentConfig.proton_version || "");
    setLaunchOptions(currentConfig.launch_options || "");
    const srcDeps = currentConfig.proton_dependencies || [];
    setCheckedDeps(srcDeps.filter((d) => POPULAR_DEPS.includes(d)));
    setCustomDeps(srcDeps.filter((d) => !POPULAR_DEPS.includes(d)).join(", "));
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
      launch_options: currentConfig.launch_options || null,
      collections: currentConfig.collections || [],
    });
    setNeedsRestartAfterAdd(currentConfig.needs_restart_after_add ?? false);
    setNeedsRestart(currentConfig.needs_restart ?? false);
  }, [selectedSourceIdx]);

  // ── Init on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    listProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
    // Fetch fresh game config — parent's games array may be stale after Apply Config
    getGame(game.name, selectedSource.source_id).then((res) => {
      if (res.success && res.game) {
        const g = res.game;
        // Refresh all form fields so they reflect the latest saved config
        setName(g.name);
        setStoredName(g.name);
        setExecutable(g.executable);
        setStartDir(g.start_dir || "");
        setSteamAppId(g.steam_app_id);
        setSteamAppIdInput(g.steam_app_id !== undefined ? String(g.steam_app_id) : "");
        setProtonVersion(g.proton_version || "");
        setLaunchOptions(g.launch_options || "");
        const freshDeps = g.proton_dependencies || [];
        setCheckedDeps(freshDeps.filter((d) => POPULAR_DEPS.includes(d)));
        setCustomDeps(freshDeps.filter((d) => !POPULAR_DEPS.includes(d)).join(", "));
        const freshColls = g.collections || [];
        setCheckedCollections(freshColls.filter((c) => steamCollections.includes(c)));
        setCustomCollections(freshColls.filter((c) => !steamCollections.includes(c)).join(", "));
        setNeedsRestart(g.needs_restart ?? false);
        setNeedsRestartAfterAdd(g.needs_restart_after_add ?? false);
        // Sync configSnapshot with what's actually on disk
        setConfigSnapshot({
          name: g.name,
          executable: g.executable,
          start_dir: g.start_dir || null,
          steam_app_id: g.steam_app_id ?? null,
          proton_version: g.proton_version || null,
          proton_dependencies: g.proton_dependencies || [],
          launch_options: g.launch_options || null,
          collections: g.collections || [],
        });
        // Restore persisted snapshots so green state survives navigation
        if (g.steam_snapshot) {
          try { setLastSyncedSnapshot(JSON.parse(g.steam_snapshot)); } catch {}
        } else {
          setLastSyncedSnapshot(null);
        }
        setLastInstalledDeps(g.deps_snapshot ?? []);
      }
    }).catch(() => {});
  }, [game.name, selectedSource?.source_id]);

  useEffect(() => {
    listAllSources().then(setAllSources).catch(() => {});
    listActiveTransfers()
      .then((transfers) => {
        // Only reconnect to truly running transfers — skip cancelled ones still winding down
        const mine = transfers.find(
          (t) => t.game_name === game.name && t.status === "running",
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
        if (ts.status !== "running") clearInterval(poll);
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

  // ── Restore processing state on mount (e.g. Installing… survived navigation) ──
  useEffect(() => {
    getGameProcessingState(game.name, selectedSource.source_id)
      .then((state: any) => {
        if (state?.status === "installing") {
          setLoading("deps");
          setFeedback({ ok: false, msg: "Installing dependencies — this can take a few minutes" });
        }
      })
      .catch(() => {});
  }, [game.name]);

  // ── Auto-save (none — use "Apply Config" button) ─────────────────────

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
    setShowSgdbPicker(false);
  };

  const handleApplySgdbArt = async () => {
    if (!selectedSgdbGame || !steamInfo || needsRestartAfterAdd) return;
    setLoading("art");
    setSgdbFeedback(null);
    try {
      const { applied, errors } = await applyArtById(
        selectedSgdbGame.id,
        steamInfo.unsigned_appid,
        selectedSgdbGame.name
      );
      if (applied.length > 0) {
        setSgdbFeedback({ ok: true, msg: `Applied ${applied.join(", ")} art from "${selectedSgdbGame.name}"` });
      } else {
        setSgdbFeedback({ ok: false, msg: errors.join("; ") || "No art found" });
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
        launch_options: launchOptions || null,
        collections: mergedCollections,
      };
      const res = await updateGameConfig(storedName, payload, selectedSource.source_id);
      if (!res.success) {
        setConfigFeedback({ ok: false, msg: "Failed to save config" });
      } else {
        setStoredName(name);
        setConfigFeedback({ ok: true, msg: "Config saved" });
        setConfigSnapshot(payload);
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
        launchOptions || "",
        protonVersion || undefined,
        mergedCollections.length > 0 ? mergedCollections : undefined,
        selectedSource.source_id
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setNeedsRestartAfterAdd(true);
        setNeedsRestart(true);
        setLastSyncedSnapshot({ name, executable, start_dir: startDir || null, launch_options: launchOptions || null, proton_version: protonVersion || null, collections: mergedCollections });
        updateGameConfig(storedName, { steam_snapshot: JSON.stringify({ name, executable, start_dir: startDir || null, launch_options: launchOptions || null, proton_version: protonVersion || null, collections: mergedCollections }), needs_restart_after_add: true, needs_restart: true }, selectedSource.source_id).catch(() => {});
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
        launchOptions || "",
        protonVersion || undefined,
        mergedCollections.length > 0 ? mergedCollections : undefined,
        selectedSource.source_id
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setNeedsRestart(true);
        setLastSyncedSnapshot({ name, executable, start_dir: startDir || null, launch_options: launchOptions || null, proton_version: protonVersion || null, collections: mergedCollections });
        updateGameConfig(storedName, { steam_snapshot: JSON.stringify({ name, executable, start_dir: startDir || null, launch_options: launchOptions || null, proton_version: protonVersion || null, collections: mergedCollections }), needs_restart: true }, selectedSource.source_id).catch(() => {});
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

  const handleInitPrefix = async () => {
    if (needsRestartAfterAdd || !steamInfo) return;
    setLoading("init");
    setFeedback(null);
    try {
      const res = await initPrefix(
        steamInfo.app_id,
        protonVersion || undefined,
        forceReinit
      );
      if (res.success) {
        setFeedback({ ok: true, msg: "Prefix initialized" });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to init prefix" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleInstallDeps = async () => {
    if (needsRestartAfterAdd || !steamInfo || mergedDeps.length === 0 || loading === "deps") return;
    setLoading("deps");
    setFeedback({ ok: false, msg: "Installing dependencies — this can take a few minutes" });
    // Persist processing state so it survives navigation away
    setGameProcessingState(game.name, {
      status: "installing",
      deps: mergedDeps,
      pfxid: String(steamInfo.unsigned_appid),
    }, selectedSource.source_id).catch(() => {});
    try {
      const res = await installDeps(
        String(steamInfo.unsigned_appid),
        mergedDeps.join(", ")
      );
      // Clear processing state on completion
      setGameProcessingState(game.name, null, selectedSource.source_id).catch(() => {});
      if (res.success) {
        const installed = (res.installed || []).join(", ");
        setFeedback({ ok: true, msg: `Installed: ${installed}` });
        setLastInstalledDeps(mergedDeps);
        updateGameConfig(storedName, { deps_snapshot: mergedDeps }, selectedSource.source_id).catch(() => {});
      } else {
        const failed = (res.failed || []).join(", ");
        setFeedback({
          ok: false,
          msg: `Failed: ${failed || res.error || "Installation failed"}`,
        });
      }
    } catch (err: any) {
      setGameProcessingState(game.name, null, selectedSource.source_id).catch(() => {});
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
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
      launch_options: launchOptions || null,
      collections: mergedCollections,
    };
    return JSON.stringify(current) !== JSON.stringify(configSnapshot);
  })();

  // ── Sync/install needed comparisons — drives green on action buttons ──
  const steamNeedsSync = (() => {
    // null = no prior sync at all (e.g. game was never Added/Updated to Steam
    // or was imported from an older config). Show green to encourage first sync.
    if (!lastSyncedSnapshot) return true;
    const a = lastSyncedSnapshot;
    const b = {
      name: configSnapshot.name,
      executable: configSnapshot.executable,
      start_dir: configSnapshot.start_dir,
      launch_options: configSnapshot.launch_options,
      proton_version: configSnapshot.proton_version,
      collections: configSnapshot.collections,
    };
    return JSON.stringify(a) !== JSON.stringify(b);
  })();

  const depsNeedsInstall = (() => {
    const saved = configSnapshot.proton_dependencies || [];
    return saved.length > 0 && JSON.stringify(saved) !== JSON.stringify(lastInstalledDeps);
  })();

  const handleCopyConfig = async () => {
    if (!copyConfigDest) return;
    setCopyConfigConfirming(false);
    setCopyConfigFeedback(null);
    try {
      const res = await copyGameConfig(
        game.name,
        selectedSource.source_id,
        copyConfigDest.source_id,
      );
      setCopyConfigFeedback(res.success ? "✓ Config copied" : `✗ ${res.error ?? "Failed"}`);
    } catch (e) {
      setCopyConfigFeedback(`✗ ${String(e)}`);
    }
    setCopyConfigDest(null);
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
              {selectedSource.source_name} {game.sources.length > 1 ? "▾" : ""}
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
              <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "#666" }}>({src.source_type})</span>
            </Focusable>
          ))}
        </Focusable>
      )}

      {/* ── Transfer Actions ─────────────────────────────────────────────── */}
      {(game.sources.length >= 2 ||
        allSources.some(
          (s) =>
            s.type !== "agent" &&
            !game.sources.some((gs) => gs.source_id === s.id),
        )) && (
        <div style={{ marginBottom: "10px" }}>
          <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "14px 0 10px" }} />
          <h4 style={{ margin: "0 0 10px 0" }}>Transfer Actions</h4>
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
                style={{ ...BTN_STYLE, padding: "4px 10px", fontSize: "0.82em" }}
              >
                {copyConfigDest ? `Copy config → ${copyConfigDest.source_name}` : "Copy config →"}
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
                    <Focusable onActivate={() => setCopyConfigConfirming(false)} onClick={() => setCopyConfigConfirming(false)} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
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
                style={{ ...BTN_STYLE, padding: "4px 10px", fontSize: "0.82em" }}
              >
                {copyGameDest ? `Copy game → ${copyGameDest.name}` : "Copy game →"}
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
                    <Focusable onActivate={() => setCopyGameConfirming(false)} onClick={() => setCopyGameConfirming(false)} focusClassName="is-focused" style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em" }}>Cancel</Focusable>
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
                        style={{ cursor: "pointer", color: "#888", padding: "0 4px" }}
                      >
                        ✕
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
        </div>
      )}

      {/* ── Config Fields ──────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Game Settings</h4>

      {/* Name */}
      <label style={LABEL_STYLE}>Name</label>
      <CompactTextField
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Executable */}
      <label style={LABEL_STYLE}>Executable</label>
      <Focusable
        focusClassName=""
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: showExePicker ? "4px" : "10px",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={handleOpenExePicker}
          onClick={handleOpenExePicker}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px" }}
        >
          {showExePicker ? "✕" : "Browse"}
        </Focusable>
      </Focusable>

      {/* Executable picker dropdown */}
      {showExePicker && (
        <Focusable
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "180px",
            overflowY: "auto",
            padding: "2px 0",
          }}
        >
          {exeOptions.length === 0 && (
            <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
              No executables found in {startDir}
            </p>
          )}
          {exeOptions.map((exe) => (
            <Focusable
              key={exe}
              onActivate={() => handleSelectExe(exe)}
              onClick={() => handleSelectExe(exe)}
              focusClassName="is-focused"
              style={{
                margin: "0 2px",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                borderBottom: "1px solid #333",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {exe}
            </Focusable>
          ))}
        </Focusable>
      )}

      {/* Start Dir */}
      <label style={LABEL_STYLE}>Start Dir</label>
      <CompactTextField
        value={startDir}
        onChange={(e) => setStartDir(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Steam App ID */}
      <label style={LABEL_STYLE}>Steam App ID</label>
      <CompactTextField
        value={steamAppIdInput}
        onChange={(e) => {
          setSteamAppIdInput(e.target.value);
          const parsed = parseInt(e.target.value, 10);
          setSteamAppId(isNaN(parsed) ? undefined : parsed);
        }}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Launch Options */}
      <label style={LABEL_STYLE}>Launch Options</label>
      <CompactTextField
        value={launchOptions}
        onChange={(e) => setLaunchOptions(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* ── Collections: Toggle Chips + Custom ──────────────────────────── */}
      <label style={LABEL_STYLE}>
        Collections
        <span style={{ color: "#666", fontWeight: "normal" }}>
          {" "}
          (click to select)
        </span>
      </label>

      <div
        style={{
          marginBottom: "8px",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "8px",
        }}
      >
        {steamCollections.length > 0 && (
          <Focusable
            focusClassName=""
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginBottom: "10px",
            }}
          >
            {steamCollections.map((name) => {
              const selected = checkedCollections.includes(name);
              return (
                <Focusable
                  key={name}
                  onActivate={() => toggleCheckedCollection(name)}
                  onClick={() => toggleCheckedCollection(name)}
                  focusClassName="is-focused"
                  style={{
                    padding: "4px 12px",
                    fontSize: "0.82em",
                    border: selected
                      ? "1px solid #0078d4"
                      : "1px solid #555",
                    borderRadius: "14px",
                    background: selected ? "#0078d4" : "transparent",
                    color: selected ? "white" : "#ccc",
                    cursor: "pointer",
                  }}
                >
                  {name}
                </Focusable>
              );
            })}
          </Focusable>
        )}

        {/* Custom collections */}
        <label style={{ fontSize: "0.82em", color: "#888", display: "block", marginBottom: "2px" }}>
          Custom (comma-separated)
        </label>
        <CompactTextField
          value={customCollections}
          onChange={(e) => setCustomCollections(e.target.value)}
          placeholder={steamCollections.length > 0 ? "e.g. RPG, FPS" : "e.g. RPG, FPS, Favorites"}
          style={{ width: "100%" }}
        />
      </div>

      {/* Proton Version: inline picker */}
      <label style={LABEL_STYLE}>Proton Version</label>
      <Focusable
        onActivate={() => setShowProtonPicker((p) => !p)}
        onClick={() => setShowProtonPicker((p) => !p)}
        focusClassName="is-focused"
        style={{
          ...BTN_STYLE,
          display: "inline-block",
          padding: "4px 12px",
          marginBottom: protonPickerOpen ? "4px" : "10px",
          background: protonVersion ? "transparent" : "transparent",
          color: protonVersion ? "#e0e0e0" : "#888",
        }}
      >
        {protonVersion || "— None —"}
      </Focusable>
      {protonPickerOpen && (
        <div
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "200px",
            overflowY: "auto",
            padding: "2px 0",
          }}
        >
          <Focusable
            onActivate={() => { setProtonVersion(""); setShowProtonPicker(false); }}
            onClick={() => { setProtonVersion(""); setShowProtonPicker(false); }}
            focusClassName="is-focused"
            style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: !protonVersion ? "#0078d4" : "#ccc" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            — None —
          </Focusable>
          {protonVersions.map((v) => (
            <Focusable
              key={v}
              onActivate={() => { setProtonVersion(v); setShowProtonPicker(false); }}
              onClick={() => { setProtonVersion(v); setShowProtonPicker(false); }}
              focusClassName="is-focused"
              style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: protonVersion === v ? "#0078d4" : "#ccc" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {v}
            </Focusable>
          ))}
        </div>
      )}

      {/* ── Dependencies: Toggle Chips + Custom ──────────────────────── */}
      <label style={LABEL_STYLE}>
        Dependencies
        <span style={{ color: "#666", fontWeight: "normal" }}>
          {" "}
          (click to select)
        </span>
      </label>

      <div
        style={{
          marginBottom: "8px",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "8px",
        }}
      >
        <Focusable
          focusClassName=""
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "10px",
          }}
        >
          {POPULAR_DEPS.map((dep) => {
            const selected = checkedDeps.includes(dep);
            return (
              <Focusable
                key={dep}
                onActivate={() => toggleCheckedDep(dep)}
                onClick={() => toggleCheckedDep(dep)}
                focusClassName="is-focused"
                style={{
                  padding: "4px 12px",
                  fontSize: "0.82em",
                  border: selected
                    ? "1px solid #0078d4"
                    : "1px solid #555",
                  borderRadius: "14px",
                  background: selected ? "#0078d4" : "transparent",
                  color: selected ? "white" : "#ccc",
                  cursor: "pointer",
                }}
              >
                {dep}
              </Focusable>
            );
          })}
        </Focusable>

        {/* Custom dependencies */}
        <label style={{ fontSize: "0.82em", color: "#888", display: "block", marginBottom: "2px" }}>
          Custom (comma-separated)
        </label>
        <CompactTextField
          value={customDeps}
          onChange={(e) => setCustomDeps(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {/* ── SteamDB lookup ──────────────────────────────────────────────── */}
      <div style={{ fontSize: "0.82em", color: "#888", marginBottom: "8px" }}>
        Look up dependencies on{" "}
        <Focusable
          onActivate={() =>
            Navigation.NavigateToExternalWeb(
              steamAppId
                ? `https://steamdb.info/app/${steamAppId}/`
                : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`
            )
          }
          onClick={() =>
            Navigation.NavigateToExternalWeb(
              steamAppId
                ? `https://steamdb.info/app/${steamAppId}/`
                : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`
            )
          }
          focusClassName="is-focused"
          style={{ color: "#0078d4", textDecoration: "underline", cursor: "pointer", display: "inline" }}
        >
          SteamDB
        </Focusable>
        {" — "}under Depots → Redistributables
        {steamAppId && (
          <span style={{ color: "#666" }}> (App {steamAppId})</span>
        )}
      </div>

      {/* Apply Config */}
      <Focusable
        onActivate={capabilities.can_write_config ? handleApplyConfig : undefined}
        onClick={capabilities.can_write_config ? handleApplyConfig : undefined}
        focusClassName="is-focused"
        style={{
          ...BTN_STYLE,
          display: "inline-block",
          marginBottom: "8px",
          border: configDirty && capabilities.can_write_config ? "1px solid #27ae60" : "1px solid #555",
          color: configDirty && capabilities.can_write_config ? "#2ecc71" : "#e0e0e0",
          opacity: capabilities.can_write_config ? 1 : 0.4,
        }}
      >
        {configDirty && capabilities.can_write_config ? "Apply Config *" : "Apply Config"}
      </Focusable>
      {configFeedback && (
        <p
          style={{
            marginTop: "0",
            marginBottom: "8px",
            fontSize: "0.85em",
            color: configFeedback.ok ? "#2ecc71" : "tomato",
          }}
        >
          {configFeedback.msg}
        </p>
      )}

      {/* ── Separator ──────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "14px 0" }} />

      {/* ── Steam Status ────────────────────────────────────────────────── */}
      <div
        style={{
          fontSize: "0.85em",
          color: "#aaa",
          marginBottom: "12px",
        }}
      >
        {steamInfo ? (
          <>✅ In Steam (App {steamInfo.unsigned_appid})</>
        ) : (
          <>Not in Steam</>
        )}
        {currentProton && <> · Proton: {currentProton}</>}
      </div>

      {/* ── Restart required warning ─────────────────────────────────────── */}
      {needsRestartAfterAdd && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "10px",
            borderRadius: "4px",
            background: "rgba(230, 126, 34, 0.15)",
            border: "1px solid rgba(230, 126, 34, 0.3)",
            fontSize: "0.82em",
            color: "#e67e22",
          }}
        >
          ⚠ Restart Steam to unlock Init Prefix, Install Dependencies, and Apply Art
        </div>
      )}

      {/* Capability lock notice */}
      {!capabilities.can_play && (
        <div style={{ padding: "8px 10px", borderRadius: "4px", background: "rgba(52,73,94,0.3)",
          border: "1px solid #2c3e50", fontSize: "0.78em", color: "#7f8c8d", marginBottom: "8px" }}>
          🔒 Steam & prefix actions unavailable — games on {selectedSource.source_type} sources can't be launched by Steam
        </div>
      )}

      {/* ── Steam Actions ─────────────────────────────────────────────────── */}
      <label style={{ ...LABEL_STYLE, marginTop: "14px", marginBottom: "6px", fontSize: "0.9em", color: "#999" }}>
        Steam Actions
      </label>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          marginBottom: "14px",
          alignItems: "flex-start",
        }}
      >
        <Focusable
          onActivate={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
          onClick={capabilities.can_play ? (steamInfo ? handleUpdateSteam : handleAddToSteam) : undefined}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !capabilities.can_play || loading === "add" || loading === "update" ? 0.4 : 1,
            border: capabilities.can_play && steamNeedsSync ? "1px solid #27ae60" : "1px solid #555",
            color: capabilities.can_play && steamNeedsSync ? "#2ecc71" : "#e0e0e0",
          }}
        >
          {loading === "add"
            ? "Adding…"
            : loading === "update"
            ? "Updating…"
            : steamInfo
            ? "Update Steam"
            : "Add to Steam"}
        </Focusable>

        <Focusable focusClassName="" style={{ display: "flex", gap: "6px" }}>
          <Focusable
            onActivate={capabilities.can_play ? handleInitPrefix : undefined}
            onClick={capabilities.can_play ? handleInitPrefix : undefined}
            focusClassName="is-focused"
            style={{
              ...BTN_STYLE,
              opacity: !capabilities.can_play || !steamInfo || needsRestartAfterAdd || loading === "init" ? 0.4 : 1,
            }}
          >
            {loading === "init" ? "Initing…" : forceReinit ? "Re-init Prefix" : "Init Prefix"}
          </Focusable>

          <Focusable
            onActivate={() => setForceReinit(!forceReinit)}
            onClick={() => setForceReinit(!forceReinit)}
            focusClassName="is-focused"
            style={{
              ...BTN_STYLE,
              padding: "8px 10px",
              minWidth: "70px",
              background: forceReinit ? "#ff6666" : "transparent",
              borderColor: forceReinit ? "#ff6666" : "#555",
              color: needsRestartAfterAdd ? "#555" : forceReinit ? "white" : "#aaa",
              opacity: needsRestartAfterAdd ? 0.4 : 1,
            }}
          >
            {forceReinit ? "☑ Force" : "☐ Force"}
          </Focusable>
        </Focusable>

        <Focusable
          onActivate={capabilities.can_play ? handleInstallDeps : undefined}
          onClick={capabilities.can_play ? handleInstallDeps : undefined}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !capabilities.can_play || !steamInfo || needsRestartAfterAdd || mergedDeps.length === 0 || loading === "deps" ? 0.4 : 1,
            border: capabilities.can_play && depsNeedsInstall ? "1px solid #27ae60" : "1px solid #555",
            color: capabilities.can_play && depsNeedsInstall ? "#2ecc71" : "#e0e0e0",
          }}
        >
          {loading === "deps" ? "Installing…" : "Install Dependencies"}
        </Focusable>

        {/* Restart Steam */}
        <Focusable
          onActivate={handleRestartSteam}
          onClick={handleRestartSteam}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            border: needsRestart ? "1px solid #27ae60" : "1px solid #555",
            color: needsRestart ? "#2ecc71" : "#e0e0e0",
          }}
        >
          {restarting ? "…" : "↺ Restart Steam"}
        </Focusable>

      </div>

      {/* ── Feedback ───────────────────────────────────────────────────── */}
      {feedback && (
        <p
          style={{
            marginTop: "12px",
            color: feedback.ok ? "lightgreen" : "tomato",
            fontSize: "0.9em",
          }}
        >
          {feedback.msg}
        </p>
      )}

      {/* ── SteamGridDB Art ─────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "24px 0 8px" }} />

      <label style={{ ...LABEL_STYLE, marginBottom: "8px" }}>
        SteamGridDB Art
        <span style={{ color: "#666", fontWeight: "normal" }}>
          {" "}
          (pick the matching game, then Apply)
        </span>
      </label>

      <Focusable focusClassName="" style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
        <Focusable
          onActivate={handleOpenSgdbPicker}
          onClick={handleOpenSgdbPicker}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            flex: 1,
            padding: "4px 12px",
            color: selectedSgdbGame ? "#e0e0e0" : "#888",
            opacity: needsRestartAfterAdd || !steamInfo ? 0.4 : 1,
          }}
        >
          {selectedSgdbGame
            ? `🎮 ${selectedSgdbGame.name} (ID: ${selectedSgdbGame.id})`
            : "Search…"}
        </Focusable>

        <Focusable
          onActivate={handleApplySgdbArt}
          onClick={handleApplySgdbArt}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            padding: "4px 12px",
            opacity: !selectedSgdbGame || !steamInfo || needsRestartAfterAdd || loading === "art" ? 0.4 : 1,
          }}
        >
          {loading === "art" ? "Applying…" : "Apply"}
        </Focusable>
      </Focusable>

      {/* SGDB art feedback */}
      {sgdbFeedback && (
        <p
          style={{
            marginTop: "4px",
            marginBottom: showSgdbPicker ? "4px" : "10px",
            color: sgdbFeedback.ok ? "lightgreen" : "tomato",
            fontSize: "0.85em",
          }}
        >
          {sgdbFeedback.msg}
        </p>
      )}

      {/* SGDB picker dropdown */}
      {showSgdbPicker && (
        <Focusable
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "180px",
            overflowY: "auto",
            padding: "2px 0",
          }}
        >
          {sgdbGames.length === 0 && (
            <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
              No matching games found on SteamGridDB for "{name}"
            </p>
          )}
          {sgdbGames.map((g) => (
            <Focusable
              key={g.id}
              onActivate={() => handleSelectSgdbGame(g)}
              onClick={() => handleSelectSgdbGame(g)}
              focusClassName="is-focused"
              style={{
                margin: "0 2px",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                borderBottom: "1px solid #333",
                color: selectedSgdbGame?.id === g.id ? "#0078d4" : "#ccc",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              🎮 {g.name} (ID: {g.id})
            </Focusable>
          ))}
        </Focusable>
      )}

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "24px 0 8px" }} />
      <div style={{ fontSize: "0.8em", color: "#e74c3c", marginBottom: "8px", fontWeight: "bold" }}>
        ⚠ Danger Zone
      </div>

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
                border: "1px solid #9b59b6",
                borderRadius: "4px",
                padding: "10px",
                marginBottom: "8px",
                textAlign: "center",
                fontSize: "0.85em",
                color: "#9b59b6",
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
                    border: "1px solid #9b59b6",
                    background: "#9b59b6",
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
                border: "1px solid #9b59b6",
                background: "transparent",
                color: "#9b59b6",
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
          <div style={{ marginBottom: "6px" }}>Remove from Deckyfin? This cannot be undone.</div>
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
          Remove from Deckyfin
        </Focusable>
      )}

    </Focusable>
  );
};
