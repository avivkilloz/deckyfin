import { VFC, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { callable } from "@decky/api";
import { Focusable } from "@decky/ui";
import { MergedGame, Source, TransferStatus } from "../types";
import { useArtwork } from "../hooks/useArtwork";
import { GameCard } from "../components/GameCard";
import { SettingsPage } from "../components/SettingsPage";
import { GameDetail } from "../components/GameDetail";
import { CompactTextField } from "../components/CompactTextField";

const getGames = callable<[], MergedGame[]>("get_games");
const listNonSteamGames = callable<[], { name: string }[]>("list_nonsteam_games");
const getUiState = callable<[], Record<string, any>>("get_ui_state");
const saveUiState = callable<[state: Record<string, any>], { success: boolean }>("save_ui_state");
const getViewMode = callable<[], string>("get_view_mode");
const setViewModeBackend = callable<[mode: string], { success: boolean }>("set_view_mode");
const getArtEnabled = callable<[], { art_enabled: boolean }>("get_art_enabled");
const setArtEnabledBackend = callable<[enabled: boolean], { success: boolean }>("set_art_enabled");
const restartSteam = callable<[], { success: boolean; message?: string }>("restart_steam");
const getNeedsRestart = callable<[], boolean>("get_needs_restart");
const setNeedsRestart = callable<[value: boolean], { success: boolean }>("set_needs_restart");
const listActiveTransfers = callable<[], TransferStatus[]>("list_active_transfers");
const listAllSources = callable<[], Source[]>("list_sources");
const cancelTransfer = callable<[transfer_id: string], { success: boolean }>("cancel_transfer");
const clearTransfer = callable<[transfer_id: string], { success: boolean }>("clear_transfer");
const getProtonInstallStatuses = callable<[], Record<string, { status: string; bytes_downloaded: number; total_bytes: number; error: string | null }>>("get_proton_install_statuses");
const cancelProtonInstall = callable<[install_name: string], { success: boolean; error: string | null }>("cancel_proton_install");
const clearProtonInstallStatus = callable<[install_name: string], { success: boolean }>("clear_proton_install_status");
const getDepInstallStatuses = callable<[], Record<string, { game_name: string; source_id: string; status: string; installed: string[]; failed_deps: string[]; error: string | null }>>("get_dep_install_statuses");
const clearDepInstallStatus = callable<[game_name: string, source_id: string], { success: boolean }>("clear_dep_install_status");
const listConfigCopyStatuses = callable<[], Record<string, { copy_id: string; game_name: string; from_source_id: string; to_source_id: string; status: string; error: string | null }>>("list_config_copy_statuses");
const clearConfigCopyStatus = callable<[copy_id: string], { success: boolean }>("clear_config_copy_status");
const listPrefixInitStatuses = callable<[], Record<string, { prefix_id: string; game_name: string; app_id: number; status: string; error: string | null }>>("list_prefix_init_statuses");
const clearPrefixInitStatus = callable<[prefix_id: string], { success: boolean }>("clear_prefix_init_status");
const listSaveSyncStatuses = callable<[], Record<string, { sync_id: string; game_name: string; source_id: string; direction: string; from_source_id?: string; to_source_id?: string; status: string; error: string | null; copied: string[]; saves_dir?: string }>>("list_save_sync_statuses");
const clearSaveSyncStatus = callable<[sync_id: string], { success: boolean }>("clear_save_sync_status");
const backupAllSaves = callable<[source_id: string], { success: boolean; started?: string[]; skipped?: string[]; failed?: string[]; error?: string }>("backup_all_saves");
const batchAddToSteam = callable<[source_id: string], { success: boolean; job_id?: string; error?: string }>("batch_add_to_steam");
const getArtEligibleGames = callable<[], { id: string; name: string; sgdb_id: number; unsigned_appid: number | null }[]>("get_art_eligible_games");
const applyDeckyfinCardArt = callable<[game_name: string, sgdb_id: number, game_id?: string], { success: boolean; error?: string }>("apply_deckyfin_card_art");
const listBatchAddStatuses = callable<[], Record<string, { job_id: string; source_name: string; status: string; current_game: string; total: number; processed: number; added: string[]; updated: string[]; skipped: string[]; failed: { name: string; reason: string }[]; needs_restart: boolean; error: string | null }>>("list_batch_add_statuses");
const clearBatchAddStatus = callable<[job_id: string], { success: boolean }>("clear_batch_add_status");

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

type SteamFilter = "all" | "in-steam" | "not-in-steam";

const BTN: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: "0.82em",
  cursor: "pointer",
  borderRadius: "4px",
  border: "1px solid #555",
  background: "transparent",
  color: "#e0e0e0",
  whiteSpace: "nowrap" as const,
};

const CHIP = (active: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: "12px",
  fontSize: "0.8em",
  cursor: "pointer",
  border: active ? "1px solid #27ae60" : "1px solid #555",
  color: active ? "#2ecc71" : "#aaa",
  background: active ? "#1a3a1a" : "transparent",
  margin: "0 2px",
});

// Module-level: survives component unmount so art apply progress is visible after reopening the panel.
type ArtApplyProgress = { running: boolean; current: number; total: number; currentGame: string; applied: string[]; failed: { name: string; reason: string }[] };
let _artApplySnapshot: ArtApplyProgress | null = null;

export const GameLibrary: VFC = () => {
  const { applyArtById } = useArtwork();
  const [games, setGames] = useState<MergedGame[]>([]);
  const [steamNames, setSteamNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "settings" | "game-detail" | "tasks">("library");
  const [selectedGame, setSelectedGame] = useState<MergedGame | null>(null);
  const [initialSourceId, setInitialSourceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [needsRestart, setNeedsRestartState] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [artEnabled, setArtEnabled] = useState(true);
  const shouldRestoreState = useRef(true);

  // Filter state
  const [showGlobalActions, setShowGlobalActions] = useState(false);
  const [showBackupAllPicker, setShowBackupAllPicker] = useState(false);
  const [backupAllSourceId, setBackupAllSourceId] = useState<string | null>(null);
  const [backupAllRunning, setBackupAllRunning] = useState(false);
  const [backupAllFeedback, setBackupAllFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [showAddToSteamPicker, setShowAddToSteamPicker] = useState(false);
  const [addToSteamSourceId, setAddToSteamSourceId] = useState<string | null>(null);
  const [addToSteamRunning, setAddToSteamRunning] = useState(false);

  const [applyArtRunning, setApplyArtRunning] = useState(false);
  const [showApplyArtConfirm, setShowApplyArtConfirm] = useState(false);

  type BatchAddEntry = { job_id: string; source_name: string; status: string; current_game: string; total: number; processed: number; added: string[]; updated: string[]; skipped: string[]; failed: { name: string; reason: string }[]; needs_restart: boolean; error: string | null };
  const [batchAddJobs, setBatchAddJobs] = useState<Record<string, BatchAddEntry>>({});
  const [dismissedBatchAddIds, setDismissedBatchAddIds] = useState<Set<string>>(new Set());
  const dismissBatchAdd = (id: string) => setDismissedBatchAddIds((prev) => new Set([...prev, id]));

  const [artApplyProgress, _setArtApplyProgressState] = useState<ArtApplyProgress | null>(() => _artApplySnapshot);
  // Wrapper that keeps the module-level snapshot in sync so progress survives panel close/reopen.
  const setArtApplyProgress = useCallback((update: ArtApplyProgress | null | ((prev: ArtApplyProgress | null) => ArtApplyProgress | null)) => {
    const next = typeof update === "function" ? update(_artApplySnapshot) : update;
    _artApplySnapshot = next;
    _setArtApplyProgressState(next);
  }, []);
  // When this component remounts while a loop is running on a previous (unmounted) instance,
  // the old instance's _setArtApplyProgressState calls are silently dropped by React.
  // Poll _artApplySnapshot so this instance stays in sync with the still-running loop.
  useEffect(() => {
    if (!artApplyProgress?.running) return;
    const poll = setInterval(() => { _setArtApplyProgressState(_artApplySnapshot); }, 500);
    return () => clearInterval(poll);
  }, [artApplyProgress?.running]);

  type SaveSyncEntry = { sync_id: string; game_name: string; source_id: string; direction: string; from_source_id?: string; to_source_id?: string; status: string; error: string | null; copied: string[]; total_games?: number; completed_games?: number; failed_games?: number; skipped_games?: number };
  const [saveSyncs, setSaveSyncs] = useState<Record<string, SaveSyncEntry>>({});

  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterSourceIds, setFilterSourceIds] = useState<Set<string>>(new Set());
  const [filterSteamStatus, setFilterSteamStatus] = useState<SteamFilter>("all");
  const [filterCollections, setFilterCollections] = useState<Set<string>>(new Set());

  const hasActiveFilters =
    searchQuery !== "" || filterSourceIds.size > 0 || filterSteamStatus !== "all" || filterCollections.size > 0;

  const activeFilterCount =
    (filterSourceIds.size > 0 ? 1 : 0) +
    (filterSteamStatus !== "all" ? 1 : 0) +
    (filterCollections.size > 0 ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery("");
    setFilterSourceIds(new Set());
    setFilterSteamStatus("all");
    setFilterCollections(new Set());
  };

  const toggleSourceFilter = (id: string) => {
    setFilterSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCollectionFilter = (col: string) => {
    setFilterCollections((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  // Derive unique sources from loaded games
  const allSources = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; type: string }>();
    games.forEach((g) =>
      g.sources.forEach((s) => {
        if (!seen.has(s.source_id))
          seen.set(s.source_id, { id: s.source_id, name: s.source_name, type: s.source_type });
      })
    );
    return Array.from(seen.values());
  }, [games]);

  // Derive all collection names across all games (from config, regardless of Steam sync)
  const allCollections = useMemo(() => {
    const seen = new Set<string>();
    games.forEach((g) =>
      g.sources.forEach((s) =>
        (s.config.collections || []).forEach((c) => seen.add(c))
      )
    );
    return Array.from(seen).sort();
  }, [games]);

  const handleRestartSteam = useCallback(async () => {
    setRestarting(true);
    try {
      await restartSteam();
      setNeedsRestartState(false);
    } catch (_) {}
    setRestarting(false);
  }, []);

  const handleBackupAllSaves = useCallback(async (sourceId: string) => {
    setBackupAllRunning(true);
    setBackupAllFeedback(null);
    try {
      const res = await backupAllSaves(sourceId);
      if (res.success) {
        setShowBackupAllPicker(false);
        setBackupAllSourceId(null);
        // Immediately populate the tasks view with the new batch + individual entries
        listSaveSyncStatuses().then((s) => setSaveSyncs(s || {})).catch(() => {});
        setBackupAllFeedback({ ok: true, msg: `Started backup for ${(res.started || []).length} game(s) — see Background Tasks` });
      } else {
        setBackupAllFeedback({ ok: false, msg: res.error || "Backup failed" });
      }
    } catch (e: any) {
      setBackupAllFeedback({ ok: false, msg: String(e) });
    }
    setBackupAllRunning(false);
  }, [setSaveSyncs]);

  const handleAddToSteam = useCallback(async (sourceId: string) => {
    setAddToSteamRunning(true);
    try {
      const res = await batchAddToSteam(sourceId);
      if (res.success) {
        setShowAddToSteamPicker(false);
        setAddToSteamSourceId(null);
        listBatchAddStatuses().then((s) => setBatchAddJobs(s || {})).catch(() => {});
      }
    } catch (_) {}
    setAddToSteamRunning(false);
  }, []);

  const handleApplyGamesArt = useCallback(async () => {
    setApplyArtRunning(true);
    try {
      const games = await getArtEligibleGames();
      if (!games?.length) { setApplyArtRunning(false); return; }

      setArtApplyProgress({ running: true, current: 0, total: games.length, currentGame: "", applied: [], failed: [] });

      const applied: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        setArtApplyProgress((prev) => prev ? { ...prev, current: i, currentGame: g.name } : prev);

        const errors: string[] = [];
        let anyOk = false;

        if (g.unsigned_appid) {
          try {
            const res = await applyArtById(g.sgdb_id, g.unsigned_appid, g.name);
            if (res.applied.length > 0) anyOk = true;
            else errors.push(...res.errors);
          } catch (err: any) {
            errors.push(err?.message || "Failed to apply Steam art");
          }
        }

        try {
          const res = await applyDeckyfinCardArt(g.name, g.sgdb_id, g.id);
          if (res.success) anyOk = true;
          else if (res.error) errors.push(res.error);
        } catch (err: any) {
          errors.push(err?.message || "Failed to apply card art");
        }

        if (anyOk) {
          applied.push(g.name);
        } else {
          failed.push({ name: g.name, reason: errors.join("; ") || "Unknown error" });
        }
      }

      setArtApplyProgress({ running: false, current: games.length, total: games.length, currentGame: "", applied, failed });
    } catch (_) {
      setArtApplyProgress((prev) => prev ? { ...prev, running: false } : null);
    }
    setApplyArtRunning(false);
  }, [applyArtById]);

  useEffect(() => {
    getNeedsRestart().then((val) => setNeedsRestartState(val)).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    let gamesRes: MergedGame[] = [];
    try {
      gamesRes = await getGames();
      setGames(gamesRes || []);
    } catch (err: any) {
      setError(String(err));
    }
    try {
      const steamGames = await listNonSteamGames();
      setSteamNames(new Set((steamGames || []).map((g) => g.name)));
    } catch (_) {
      setSteamNames(new Set());
    }
    // On first load only: restore the last open view and view mode from persisted config,
    // and pre-load all background task state so the tasks view never flashes "No background tasks."
    if (shouldRestoreState.current) {
      shouldRestoreState.current = false;
      const [
        uiStateRes, viewModeRes, artEnabledRes,
        transfersRes, sourcesRes, protonRes, depRes, copyRes, prefixRes, syncRes, batchAddRes,
      ] = await Promise.allSettled([
        getUiState(), getViewMode(), getArtEnabled(),
        listActiveTransfers(), listAllSources(), getProtonInstallStatuses(),
        getDepInstallStatuses(), listConfigCopyStatuses(), listPrefixInitStatuses(),
        listSaveSyncStatuses(), listBatchAddStatuses(),
      ]);
      if (transfersRes.status === "fulfilled") setActiveTransfers(transfersRes.value || []);
      if (sourcesRes.status === "fulfilled") setXferSources(sourcesRes.value || []);
      if (protonRes.status === "fulfilled") setProtonInstalls(protonRes.value || {});
      if (depRes.status === "fulfilled") setDepInstalls(depRes.value || {});
      if (copyRes.status === "fulfilled") setConfigCopies(copyRes.value || {});
      if (prefixRes.status === "fulfilled") setPrefixInits(prefixRes.value || {});
      if (syncRes.status === "fulfilled") setSaveSyncs(syncRes.value || {});
      if (batchAddRes.status === "fulfilled") setBatchAddJobs(batchAddRes.value || {});
      const artOn = artEnabledRes.status === "fulfilled"
        ? artEnabledRes.value.art_enabled !== false
        : true;
      setArtEnabled(artOn);
      if (!artOn) {
        setViewMode("list");
      } else if (viewModeRes.status === "fulfilled" && (viewModeRes.value === "card" || viewModeRes.value === "list")) {
        setViewMode(viewModeRes.value);
      }
      if (uiStateRes.status === "fulfilled") {
        const uiState = uiStateRes.value;
        if (uiState?.view === "game-detail" && uiState?.game_name) {
          const found = gamesRes.find((g) => g.name === uiState.game_name);
          if (found) {
            setInitialSourceId(uiState.source_id || null);
            setSelectedGame(found);
            setView("game-detail");
          }
        } else if (uiState?.view === "settings") {
          setView("settings");
        } else if (uiState?.view === "tasks") {
          setView("tasks");
        }
      }
      setIsRestoring(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const [activeTransfers, setActiveTransfers] = useState<TransferStatus[]>([]);
  const [xferSources, setXferSources] = useState<Source[]>([]);
  const [dismissedXferIds, setDismissedXferIds] = useState<Set<string>>(new Set());

  const dismissXfer = (id: string) => setDismissedXferIds((prev) => new Set([...prev, id]));

  type ProtonInstallEntry = { status: string; bytes_downloaded: number; total_bytes: number; error: string | null };
  const [protonInstalls, setProtonInstalls] = useState<Record<string, ProtonInstallEntry>>({});
  const [dismissedProtonIds, setDismissedProtonIds] = useState<Set<string>>(new Set());
  const dismissProton = (id: string) => setDismissedProtonIds((prev) => new Set([...prev, id]));

  type DepInstallEntry = { game_name: string; source_id: string; status: string; installed: string[]; failed_deps: string[]; error: string | null };
  const [depInstalls, setDepInstalls] = useState<Record<string, DepInstallEntry>>({});
  const [dismissedDepKeys, setDismissedDepKeys] = useState<Set<string>>(new Set());
  const dismissDep = (key: string) => setDismissedDepKeys((prev) => new Set([...prev, key]));

  type ConfigCopyEntry = { copy_id: string; game_name: string; from_source_id: string; to_source_id: string; status: string; error: string | null };
  const [configCopies, setConfigCopies] = useState<Record<string, ConfigCopyEntry>>({});
  const [dismissedCopyIds, setDismissedCopyIds] = useState<Set<string>>(new Set());
  const dismissCopy = (id: string) => setDismissedCopyIds((prev) => new Set([...prev, id]));

  type PrefixInitEntry = { prefix_id: string; game_name: string; app_id: number; status: string; error: string | null };
  const [prefixInits, setPrefixInits] = useState<Record<string, PrefixInitEntry>>({});
  const [dismissedPrefixIds, setDismissedPrefixIds] = useState<Set<string>>(new Set());
  const dismissPrefix = (id: string) => setDismissedPrefixIds((prev) => new Set([...prev, id]));

  const [dismissedSyncIds, setDismissedSyncIds] = useState<Set<string>>(new Set());
  const dismissSync = (id: string) => setDismissedSyncIds((prev) => new Set([...prev, id]));

  const refreshBgTasks = useCallback(async () => {
    await Promise.allSettled([
      listActiveTransfers().then((t) => setActiveTransfers(t || [])),
      listAllSources().then((s) => setXferSources(s || [])),
      getProtonInstallStatuses().then((s) => setProtonInstalls(s || {})),
      getDepInstallStatuses().then((s) => setDepInstalls(s || {})),
      listConfigCopyStatuses().then((s) => setConfigCopies(s || {})),
      listPrefixInitStatuses().then((s) => setPrefixInits(s || {})),
      listSaveSyncStatuses().then((s) => setSaveSyncs(s || {})),
      listBatchAddStatuses().then((s) => setBatchAddJobs(s || {})),
    ]);
  }, []);

  const hasRunningTransfer = activeTransfers.some((t) => t.status === "running" || t.status === "queued");
  const hasRunningProton = Object.values(protonInstalls).some((s) => s.status === "downloading" || s.status === "extracting");
  const hasRunningDep = Object.values(depInstalls).some((s) => s.status === "installing");
  const hasRunningCopy = Object.values(configCopies).some((s) => s.status === "running");
  const hasRunningPrefix = Object.values(prefixInits).some((s) => s.status === "running");
  const hasRunningSaveSync = Object.values(saveSyncs).some((s) => s.status === "running");
  const hasRunningBatchAdd = Object.values(batchAddJobs).some((s) => s.status === "running");
  const hasRunningArtApply = artApplyProgress?.running ?? false;

  const runningTaskCount =
    activeTransfers.filter((t) => t.status === "running" || t.status === "queued").length +
    Object.values(protonInstalls).filter((s) => s.status === "downloading" || s.status === "extracting").length +
    Object.values(depInstalls).filter((s) => s.status === "installing").length +
    Object.values(configCopies).filter((s) => s.status === "running").length +
    Object.values(prefixInits).filter((s) => s.status === "running").length +
    Object.values(saveSyncs).filter((s) => s.status === "running").length +
    Object.values(batchAddJobs).filter((s) => s.status === "running").length +
    (artApplyProgress?.running ? 1 : 0);

  useEffect(() => {
    if (!hasRunningTransfer && !hasRunningProton && !hasRunningDep && !hasRunningCopy && !hasRunningPrefix && !hasRunningSaveSync && !hasRunningBatchAdd) return;
    const poll = setInterval(async () => {
      try {
        if (hasRunningTransfer) {
          const t = await listActiveTransfers();
          setActiveTransfers(t || []);
        }
        if (hasRunningProton) {
          const p = await getProtonInstallStatuses();
          setProtonInstalls(p || {});
        }
        if (hasRunningDep) {
          const d = await getDepInstallStatuses();
          setDepInstalls(d || {});
        }
        if (hasRunningCopy) {
          const c = await listConfigCopyStatuses();
          setConfigCopies(c || {});
        }
        if (hasRunningPrefix) {
          const p = await listPrefixInitStatuses();
          setPrefixInits(p || {});
        }
        if (hasRunningSaveSync) {
          const s = await listSaveSyncStatuses();
          setSaveSyncs(s || {});
        }
        if (hasRunningBatchAdd) {
          const s = await listBatchAddStatuses();
          setBatchAddJobs(s || {});
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(poll);
  }, [hasRunningTransfer, hasRunningProton, hasRunningDep, hasRunningCopy, hasRunningPrefix, hasRunningSaveSync, hasRunningBatchAdd]);

  const openGame = (game: MergedGame) => {
    setInitialSourceId(null); // manual navigation — no source restore
    setSelectedGame(game);
    setView("game-detail");
  };

  const filteredGames = games.filter((g) => {
    if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    if (filterSourceIds.size > 0 && !g.sources.some((s) => filterSourceIds.has(s.source_id)))
      return false;
    if (filterSteamStatus === "in-steam" && !steamNames.has(g.name)) return false;
    if (filterSteamStatus === "not-in-steam" && steamNames.has(g.name)) return false;
    if (filterCollections.size > 0) {
      const gameCollections = new Set(g.sources.flatMap((s) => s.config.collections || []));
      for (const col of filterCollections) {
        if (!gameCollections.has(col)) return false;
      }
    }
    return true;
  });

  if (view === "tasks") {
    const visibleTransfers = activeTransfers.filter((x) => !dismissedXferIds.has(x.transfer_id));
    const visibleProtons = Object.entries(protonInstalls).filter(([id]) => !dismissedProtonIds.has(id));
    const visibleDeps = Object.entries(depInstalls).filter(([key]) => !dismissedDepKeys.has(key));
    const visibleCopies = Object.entries(configCopies).filter(([id]) => !dismissedCopyIds.has(id));
    const visiblePrefixes = Object.entries(prefixInits).filter(([id]) => !dismissedPrefixIds.has(id));
    const visibleSyncs = Object.entries(saveSyncs).filter(([id]) => !dismissedSyncIds.has(id));
    const visibleBatchAdds = Object.entries(batchAddJobs).filter(([id]) => !dismissedBatchAddIds.has(id));
    const hasAnyVisible = visibleTransfers.length > 0 || visibleProtons.length > 0 || visibleDeps.length > 0 || visibleCopies.length > 0 || visiblePrefixes.length > 0 || visibleSyncs.length > 0 || visibleBatchAdds.length > 0 || artApplyProgress !== null;

    return (
      <div style={{ padding: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <Focusable
            onActivate={() => { saveUiState({ view: "library" }).catch(() => {}); setView("library"); }}
            onClick={() => { saveUiState({ view: "library" }).catch(() => {}); setView("library"); }}
            focusClassName="is-focused"
            style={{ ...BTN, padding: "6px 9px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </Focusable>
          <span style={{ fontWeight: 600, fontSize: "0.95em" }}>Background Tasks</span>
        </div>

        {!hasAnyVisible && (
          <p style={{ color: "#888", fontSize: "0.88em", textAlign: "center", marginTop: "32px" }}>No background tasks.</p>
        )}

        {/* File transfers */}
        {visibleTransfers.map((xfer) => {
          const pct = xfer.total_bytes > 0 ? Math.round((xfer.bytes_copied / xfer.total_bytes) * 100) : 0;
          const fromName = xferSources.find((s) => s.id === xfer.from_source_id)?.name ?? xfer.from_source_id;
          const toName = xferSources.find((s) => s.id === xfer.to_source_id)?.name ?? xfer.to_source_id;
          return (
            <div key={xfer.transfer_id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
              {xfer.status === "queued" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#888" }}>⏳ <strong>{xfer.game_name}</strong>: {fromName} → {toName} — waiting…</span>
                  <Focusable onActivate={() => { cancelTransfer(xfer.transfer_id).catch(() => {}); dismissXfer(xfer.transfer_id); }} onClick={() => { cancelTransfer(xfer.transfer_id).catch(() => {}); dismissXfer(xfer.transfer_id); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {xfer.status === "running" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span>▸ <strong>{xfer.game_name}</strong>: {fromName} → {toName}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: "#aaa" }}>{pct}%</span>
                      <Focusable onActivate={() => cancelTransfer(xfer.transfer_id).catch(() => {})} onClick={() => cancelTransfer(xfer.transfer_id).catch(() => {})} focusClassName="is-focused" style={{ cursor: "pointer", color: "#888", fontSize: "0.9em", padding: "0 4px", border: "1px solid #555", borderRadius: "3px" }}>Cancel</Focusable>
                    </div>
                  </div>
                  <div style={{ background: "#333", borderRadius: "2px", height: "4px", marginBottom: "3px" }}>
                    <div style={{ width: `${pct}%`, background: "#0078d4", borderRadius: "2px", height: "100%", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ color: "#666" }}>{fmtBytes(xfer.bytes_copied)} / {fmtBytes(xfer.total_bytes)}</span>
                </>
              )}
              {xfer.status === "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2ecc71" }}>✓ <strong>{xfer.game_name}</strong> copied: {fromName} → {toName}</span>
                  <Focusable onActivate={() => { dismissXfer(xfer.transfer_id); clearTransfer(xfer.transfer_id).catch(() => {}); }} onClick={() => { dismissXfer(xfer.transfer_id); clearTransfer(xfer.transfer_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {xfer.status === "failed" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "tomato" }}>✗ <strong>{xfer.game_name}</strong> failed: {xfer.error ?? "Transfer failed"}</span>
                  <Focusable onActivate={() => { dismissXfer(xfer.transfer_id); clearTransfer(xfer.transfer_id).catch(() => {}); }} onClick={() => { dismissXfer(xfer.transfer_id); clearTransfer(xfer.transfer_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
            </div>
          );
        })}

        {/* Proton installs */}
        {visibleProtons.map(([tag, s]) => {
          const isDownloading = s.status === "downloading";
          const isExtracting = s.status === "extracting";
          const isActive = isDownloading || isExtracting;
          const pct = isDownloading && s.total_bytes > 0 ? Math.round((s.bytes_downloaded / s.total_bytes) * 100) : 0;
          return (
            <div key={tag} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
              {isActive && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span>↓ <strong>{tag}</strong>: {isExtracting ? "Extracting…" : `Downloading ${pct}%`}</span>
                    <Focusable onActivate={() => { cancelProtonInstall(tag).catch(() => {}); dismissProton(tag); setProtonInstalls((prev) => { const n = { ...prev }; delete n[tag]; return n; }); }} onClick={() => { cancelProtonInstall(tag).catch(() => {}); dismissProton(tag); setProtonInstalls((prev) => { const n = { ...prev }; delete n[tag]; return n; }); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#888", fontSize: "0.9em", padding: "0 4px", border: "1px solid #555", borderRadius: "3px" }}>Cancel</Focusable>
                  </div>
                  {isDownloading && (
                    <div style={{ background: "#333", borderRadius: "2px", height: "4px" }}>
                      <div style={{ width: `${pct}%`, background: "#0078d4", borderRadius: "2px", height: "100%", transition: "width 0.3s" }} />
                    </div>
                  )}
                </>
              )}
              {s.status === "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2ecc71" }}>✓ <strong>{tag}</strong> installed</span>
                  <Focusable onActivate={() => { dismissProton(tag); clearProtonInstallStatus(tag).catch(() => {}); }} onClick={() => { dismissProton(tag); clearProtonInstallStatus(tag).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {s.status === "failed" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "tomato" }}>✗ <strong>{tag}</strong> failed: {s.error ?? "Download failed"}</span>
                  <Focusable onActivate={() => { dismissProton(tag); clearProtonInstallStatus(tag).catch(() => {}); }} onClick={() => { dismissProton(tag); clearProtonInstallStatus(tag).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
            </div>
          );
        })}

        {/* Dep installs */}
        {visibleDeps.map(([key, s]) => (
          <div key={key} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
            {s.status === "installing" && <span style={{ color: "#aaa" }}>⟳ <strong>{s.game_name}</strong>: installing dependencies…</span>}
            {s.status === "done" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#2ecc71" }}>✓ <strong>{s.game_name}</strong>: deps installed{s.installed?.length ? ` (${s.installed.join(", ")})` : ""}</span>
                <Focusable onActivate={() => { dismissDep(key); clearDepInstallStatus(s.game_name, s.source_id).catch(() => {}); }} onClick={() => { dismissDep(key); clearDepInstallStatus(s.game_name, s.source_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
              </div>
            )}
            {s.status === "failed" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "tomato" }}>✗ <strong>{s.game_name}</strong>: {s.error || (s.failed_deps?.length ? `failed: ${s.failed_deps.join(", ")}` : "dep install failed")}</span>
                <Focusable onActivate={() => { dismissDep(key); clearDepInstallStatus(s.game_name, s.source_id).catch(() => {}); }} onClick={() => { dismissDep(key); clearDepInstallStatus(s.game_name, s.source_id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
              </div>
            )}
          </div>
        ))}

        {/* Config copies */}
        {visibleCopies.map(([id, s]) => {
          const fromName = xferSources.find((src) => src.id === s.from_source_id)?.name ?? s.from_source_id;
          const toName = xferSources.find((src) => src.id === s.to_source_id)?.name ?? s.to_source_id;
          return (
            <div key={id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
              {s.status === "running" && <span style={{ color: "#aaa" }}>⟳ <strong>{s.game_name}</strong>: copying config {fromName} → {toName}…</span>}
              {s.status === "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2ecc71" }}>✓ <strong>{s.game_name}</strong>: config copied {fromName} → {toName}</span>
                  <Focusable onActivate={() => { dismissCopy(id); clearConfigCopyStatus(id).catch(() => {}); }} onClick={() => { dismissCopy(id); clearConfigCopyStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {s.status === "failed" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ <strong>{s.game_name}</strong>: config copy failed — {s.error ?? "unknown error"}</span>
                  <Focusable onActivate={() => { dismissCopy(id); clearConfigCopyStatus(id).catch(() => {}); }} onClick={() => { dismissCopy(id); clearConfigCopyStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}>✕</Focusable>
                </div>
              )}
            </div>
          );
        })}

        {/* Prefix inits */}
        {visiblePrefixes.map(([id, s]) => (
          <div key={id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
            {s.status === "running" && <span style={{ color: "#aaa" }}>⟳ <strong>{s.game_name}</strong>: initializing prefix…</span>}
            {s.status === "done" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#2ecc71" }}>✓ <strong>{s.game_name}</strong>: prefix initialized</span>
                <Focusable onActivate={() => { dismissPrefix(id); clearPrefixInitStatus(id).catch(() => {}); }} onClick={() => { dismissPrefix(id); clearPrefixInitStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
              </div>
            )}
            {s.status === "failed" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ <strong>{s.game_name}</strong>: prefix init failed — {s.error ?? "unknown error"}</span>
                <Focusable onActivate={() => { dismissPrefix(id); clearPrefixInitStatus(id).catch(() => {}); }} onClick={() => { dismissPrefix(id); clearPrefixInitStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}>✕</Focusable>
              </div>
            )}
          </div>
        ))}

        {/* Save syncs */}
        {visibleSyncs.map(([id, s]) => {
          if (s.direction === "batch_backup") {
            const done = s.completed_games ?? 0;
            const total = s.total_games ?? 0;
            const failed = s.failed_games ?? 0;
            const skipped = s.skipped_games ?? 0;
            const summary = [
              done > 0 ? `${done} backed up` : null,
              failed > 0 ? `${failed} failed` : null,
              skipped > 0 ? `${skipped} skipped` : null,
            ].filter(Boolean).join(", ");
            return (
              <div key={id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
                {s.status === "running" && (
                  <span style={{ color: "#aaa" }}>⟳ <strong>{s.game_name}</strong>: {done}/{total} backed up…</span>
                )}
                {s.status === "done" && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: failed > 0 ? "#e67e22" : "#2ecc71" }}>
                      {failed > 0 ? "⚠" : "✓"} <strong>{s.game_name}</strong>: {summary || "nothing to backup"}
                    </span>
                    <Focusable onActivate={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} onClick={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                  </div>
                )}
              </div>
            );
          }
          const dirLabel = s.direction === "backup" ? "Backup saves" : s.direction === "restore" ? "Restore saves" : "Copy saves";
          const fromName = xferSources.find((src) => src.id === s.from_source_id)?.name ?? s.from_source_id;
          const toName = xferSources.find((src) => src.id === s.to_source_id)?.name ?? s.to_source_id;
          const destLabel = s.direction === "copy" && fromName && toName ? ` ${fromName} → ${toName}` : "";
          return (
            <div key={id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
              {s.status === "running" && <span style={{ color: "#aaa" }}>⟳ <strong>{s.game_name}</strong>: {dirLabel.toLowerCase()}{destLabel}…</span>}
              {s.status === "done" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#2ecc71" }}>✓ <strong>{s.game_name}</strong>: {dirLabel.toLowerCase()} done{s.copied?.length ? ` (${s.copied.length} paths)` : ""}{destLabel}</span>
                  <Focusable onActivate={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} onClick={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px" }}>✕</Focusable>
                </div>
              )}
              {s.status === "failed" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ color: "tomato", wordBreak: "break-all", minWidth: 0, flex: 1 }}>✗ <strong>{s.game_name}</strong>: {dirLabel.toLowerCase()} failed — {s.error ?? "unknown error"}</span>
                  <Focusable onActivate={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} onClick={() => { dismissSync(id); clearSaveSyncStatus(id).catch(() => {}); }} focusClassName="is-focused" style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}>✕</Focusable>
                </div>
              )}
            </div>
          );
        })}

        {/* Batch Add to Steam jobs */}
        {visibleBatchAdds.map(([id, s]) => (
          <div key={id} style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
            {s.status === "running" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>▸ Adding to Steam — <strong>{s.source_name}</strong> ({s.processed}/{s.total})</span>
                </div>
                {s.current_game && (
                  <div style={{ color: "#888", fontSize: "0.9em" }}>{s.current_game}…</div>
                )}
                <div style={{ background: "#333", borderRadius: "2px", height: "4px", marginTop: "4px" }}>
                  <div style={{ width: s.total > 0 ? `${Math.round((s.processed / s.total) * 100)}%` : "0%", background: "#0078d4", borderRadius: "2px", height: "100%", transition: "width 0.3s" }} />
                </div>
              </>
            )}
            {s.status === "done" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ color: s.failed.length > 0 ? "tomato" : "#2ecc71", flex: 1 }}>
                    {s.failed.length > 0 ? "⚠" : "✓"} <strong>{s.source_name}</strong>: {[
                      s.added.length > 0 && `Added ${s.added.length}`,
                      s.updated.length > 0 && `Updated ${s.updated.length}`,
                      s.skipped.length > 0 && `Skipped ${s.skipped.length}`,
                      s.failed.length > 0 && `Failed ${s.failed.length}`,
                    ].filter(Boolean).join(", ") || "Nothing to do"}
                    {s.needs_restart && <span style={{ color: "#888" }}> — Restart Steam</span>}
                  </span>
                  <Focusable
                    onActivate={() => { dismissBatchAdd(id); clearBatchAddStatus(id).catch(() => {}); if (s.needs_restart) setNeedsRestartState(true); }}
                    onClick={() => { dismissBatchAdd(id); clearBatchAddStatus(id).catch(() => {}); if (s.needs_restart) setNeedsRestartState(true); }}
                    focusClassName="is-focused"
                    style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}
                  >✕</Focusable>
                </div>
                {s.failed.length > 0 && (
                  <div style={{ marginTop: "4px", borderTop: "1px solid #2a2a2a", paddingTop: "4px" }}>
                    {s.failed.map((f) => (
                      <div key={f.name} style={{ color: "#888", fontSize: "0.9em", marginTop: "2px" }}>
                        <span style={{ color: "tomato" }}>{f.name}</span>: {f.reason}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Apply Art progress (frontend-driven, no restart needed) */}
        {artApplyProgress !== null && (
          <div style={{ border: "1px solid #444", borderRadius: "4px", padding: "8px 10px", marginBottom: "6px", background: "#1a1a1a", fontSize: "0.82em" }}>
            {artApplyProgress.running && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>▸ Applying art ({artApplyProgress.current}/{artApplyProgress.total || "?"})</span>
                </div>
                {artApplyProgress.currentGame && (
                  <div style={{ color: "#888", fontSize: "0.9em" }}>{artApplyProgress.currentGame}…</div>
                )}
                {artApplyProgress.total > 0 && (
                  <div style={{ background: "#333", borderRadius: "2px", height: "4px", marginTop: "4px" }}>
                    <div style={{ width: `${Math.round((artApplyProgress.current / artApplyProgress.total) * 100)}%`, background: "#0078d4", borderRadius: "2px", height: "100%", transition: "width 0.3s" }} />
                  </div>
                )}
              </>
            )}
            {!artApplyProgress.running && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ color: artApplyProgress.failed.length > 0 ? "tomato" : "#2ecc71", flex: 1 }}>
                    {artApplyProgress.failed.length > 0 ? "⚠" : "✓"} Applied art for {artApplyProgress.applied.length}/{artApplyProgress.total} game(s)
                    {artApplyProgress.failed.length > 0 && ` (${artApplyProgress.failed.length} failed)`}
                  </span>
                  <Focusable
                    onActivate={() => setArtApplyProgress(null)}
                    onClick={() => setArtApplyProgress(null)}
                    focusClassName="is-focused"
                    style={{ cursor: "pointer", color: "#666", padding: "0 4px", marginLeft: "8px", flexShrink: 0 }}
                  >✕</Focusable>
                </div>
                {artApplyProgress.failed.length > 0 && (
                  <div style={{ marginTop: "4px", borderTop: "1px solid #2a2a2a", paddingTop: "4px" }}>
                    {artApplyProgress.failed.map((f) => (
                      <div key={f.name} style={{ color: "#888", fontSize: "0.9em", marginTop: "2px" }}>
                        <span style={{ color: "tomato" }}>{f.name}</span>: {f.reason}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isRestoring) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100px", color: "#888", fontSize: "0.9em" }}>
        Loading…
      </div>
    );
  }

  if (view === "settings") {
    return <SettingsPage
      onBack={() => { saveUiState({ view: "library" }).catch(() => {}); loadData(); refreshBgTasks(); setView("library"); }}
      artEnabled={artEnabled}
      onArtEnabledChange={(val) => {
        setArtEnabled(val);
        if (!val) setViewMode("list");
        setArtEnabledBackend(val).catch(() => {});
      }}
    />;
  }

  if (view === "game-detail" && selectedGame) {
    return (
      <GameDetail
        game={selectedGame}
        initialSourceId={initialSourceId}
        runningTaskCount={runningTaskCount}
        onBack={async () => {
          saveUiState({ view: "library" }).catch(() => {});
          await loadData();
          await refreshBgTasks();
          setView("library");
        }}
        onNeedsRestart={() => {
          setNeedsRestartState(true);
          setNeedsRestart(true).catch(() => {});
          loadData();
        }}
        onNavigateToSettings={() => {
          setView("settings");
          saveUiState({ view: "settings" }).catch(() => {});
        }}
        artEnabled={artEnabled}
      />
    );
  }

  return (
    <div style={{ padding: "8px" }}>
      {/* Header */}
      <div style={{ marginBottom: "12px" }}>
        <Focusable style={{ display: "flex", gap: "6px", alignItems: "stretch" }}>
          {/* Global Actions expandable button */}
          <Focusable
            onActivate={() => setShowGlobalActions((v) => !v)}
            onClick={() => setShowGlobalActions((v) => !v)}
            focusClassName="is-focused"
            style={{
              ...BTN,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Global Actions</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {needsRestart && (
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#2ecc71", display: "inline-block", flexShrink: 0 }} />
              )}
              <span style={{ fontSize: "0.78em", color: "#666" }}>{showGlobalActions ? "▲" : "▼"}</span>
            </div>
          </Focusable>
          {/* Background tasks button */}
          <Focusable
            onActivate={() => { setView("tasks"); saveUiState({ view: "tasks" }).catch(() => {}); }}
            onClick={() => { setView("tasks"); saveUiState({ view: "tasks" }).catch(() => {}); }}
            focusClassName="is-focused"
            title="Background Tasks"
            style={{ ...BTN, padding: "6px 9px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            {runningTaskCount > 0 && (
              <span style={{
                position: "absolute", top: "-4px", right: "-4px",
                background: "#27ae60", color: "#fff",
                borderRadius: "50%", fontSize: "0.65em",
                width: "14px", height: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}>
                {runningTaskCount}
              </span>
            )}
          </Focusable>
          {/* Settings gear icon only */}
          <Focusable
            onActivate={() => { setView("settings"); saveUiState({ view: "settings" }).catch(() => {}); }}
            onClick={() => { setView("settings"); saveUiState({ view: "settings" }).catch(() => {}); }}
            focusClassName="is-focused"
            style={{ ...BTN, padding: "6px 9px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </Focusable>
        </Focusable>

        {/* Global Actions expanded list */}
        {showGlobalActions && (
          <div style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginTop: "6px", padding: "2px 0" }}>
            {/* Restart Steam */}
            <Focusable
              onActivate={runningTaskCount > 0 ? undefined : handleRestartSteam}
              onClick={runningTaskCount > 0 ? undefined : handleRestartSteam}
              focusClassName="is-focused"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "0 2px",
                padding: "7px 10px",
                cursor: runningTaskCount > 0 ? "default" : "pointer",
                fontSize: "0.85em",
                borderRadius: "4px",
                color: runningTaskCount > 0 ? "#555" : needsRestart ? "#2ecc71" : "#e0e0e0",
                opacity: runningTaskCount > 0 ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (runningTaskCount === 0) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
              <span style={{ flex: 1 }}>
                {restarting ? "Restarting…" : "Restart Steam"}
                {runningTaskCount > 0 && (
                  <span style={{ display: "block", fontSize: "0.8em", color: "#666", marginTop: "1px" }}>
                    {runningTaskCount} task{runningTaskCount > 1 ? "s" : ""} running — wait before restarting
                  </span>
                )}
              </span>
            </Focusable>

            {/* Divider */}
            <div style={{ borderTop: "1px solid #2a2a2a", margin: "2px 10px" }} />

            {/* Backup All Saves */}
            <Focusable
              onActivate={() => { setShowBackupAllPicker((v) => !v); setBackupAllFeedback(null); setBackupAllSourceId(null); }}
              onClick={() => { setShowBackupAllPicker((v) => !v); setBackupAllFeedback(null); setBackupAllSourceId(null); }}
              focusClassName="is-focused"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "0 2px",
                padding: "7px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                borderRadius: "4px",
                color: "#e0e0e0",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
                <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z" />
              </svg>
              Backup All Saves
            </Focusable>

            {/* Source picker for Backup All */}
            {showBackupAllPicker && (
              <div style={{ margin: "2px 10px 6px", padding: "8px", background: "#1a1a1a", borderRadius: "4px", border: "1px solid #2a2a2a" }}>
                <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "6px" }}>
                  Select destination source for save backups:
                </div>
                {allSources.length === 0 ? (
                  <div style={{ fontSize: "0.8em", color: "#666" }}>No sources found.</div>
                ) : (
                  <Focusable style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {allSources.map((src) => (
                      <Focusable
                        key={src.id}
                        onActivate={() => setBackupAllSourceId((v) => v === src.id ? null : src.id)}
                        onClick={() => setBackupAllSourceId((v) => v === src.id ? null : src.id)}
                        focusClassName="is-focused"
                        style={{
                          margin: "0 2px",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.82em",
                          border: backupAllSourceId === src.id ? "1px solid #27ae60" : "1px solid #333",
                          color: backupAllSourceId === src.id ? "#2ecc71" : "#c0c0c0",
                          background: backupAllSourceId === src.id ? "#1a3a1a" : "transparent",
                        }}
                      >
                        {src.name}
                      </Focusable>
                    ))}
                  </Focusable>
                )}
                {backupAllSourceId && (
                  <Focusable
                    onActivate={() => handleBackupAllSaves(backupAllSourceId)}
                    onClick={() => handleBackupAllSaves(backupAllSourceId)}
                    focusClassName="is-focused"
                    style={{
                      margin: "6px 2px 0",
                      padding: "5px 10px",
                      borderRadius: "4px",
                      cursor: backupAllRunning ? "default" : "pointer",
                      fontSize: "0.82em",
                      border: "1px solid #27ae60",
                      color: "#2ecc71",
                      background: "#1a3a1a",
                      textAlign: "center" as const,
                      opacity: backupAllRunning ? 0.5 : 1,
                    }}
                  >
                    {backupAllRunning ? "Backing up…" : "Confirm Backup"}
                  </Focusable>
                )}
                {backupAllFeedback && (
                  <div style={{ fontSize: "0.78em", marginTop: "6px", color: backupAllFeedback.ok ? "#2ecc71" : "tomato" }}>
                    {backupAllFeedback.msg}
                  </div>
                )}
              </div>
            )}

            {/* Feedback shown when picker is closed */}
            {!showBackupAllPicker && backupAllFeedback && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", margin: "0 12px 6px" }}>
                <span style={{ fontSize: "0.78em", color: backupAllFeedback.ok ? "#2ecc71" : "tomato", flex: 1 }}>
                  {backupAllFeedback.msg}
                </span>
                <Focusable
                  onActivate={() => setBackupAllFeedback(null)}
                  onClick={() => setBackupAllFeedback(null)}
                  focusClassName="is-focused"
                  style={{ cursor: "pointer", color: "#666", padding: "0 2px", fontSize: "0.82em", flexShrink: 0 }}
                >✕</Focusable>
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: "1px solid #2a2a2a", margin: "2px 10px" }} />

            {/* Add Games to Steam */}
            <Focusable
              onActivate={() => { setShowAddToSteamPicker((v) => !v); setAddToSteamSourceId(null); }}
              onClick={() => { setShowAddToSteamPicker((v) => !v); setAddToSteamSourceId(null); }}
              focusClassName="is-focused"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "0 2px",
                padding: "7px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                borderRadius: "4px",
                color: "#e0e0e0",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
              </svg>
              Add Games to Steam
            </Focusable>

            {/* Source picker for Add to Steam */}
            {showAddToSteamPicker && (
              <div style={{ margin: "2px 10px 6px", padding: "8px", background: "#1a1a1a", borderRadius: "4px", border: "1px solid #2a2a2a" }}>
                <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "6px" }}>
                  Select source to add games to Steam from:
                </div>
                {allSources.filter((s) => s.type !== "mount").length === 0 ? (
                  <div style={{ fontSize: "0.8em", color: "#666" }}>No sources found.</div>
                ) : (
                  <Focusable style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {allSources.filter((s) => s.type !== "mount").map((src) => (
                      <Focusable
                        key={src.id}
                        onActivate={() => setAddToSteamSourceId((v) => v === src.id ? null : src.id)}
                        onClick={() => setAddToSteamSourceId((v) => v === src.id ? null : src.id)}
                        focusClassName="is-focused"
                        style={{
                          margin: "0 2px",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.82em",
                          border: addToSteamSourceId === src.id ? "1px solid #27ae60" : "1px solid #333",
                          color: addToSteamSourceId === src.id ? "#2ecc71" : "#c0c0c0",
                          background: addToSteamSourceId === src.id ? "#1a3a1a" : "transparent",
                        }}
                      >
                        {src.name}
                      </Focusable>
                    ))}
                  </Focusable>
                )}
                {addToSteamSourceId && (
                  <Focusable
                    onActivate={() => !addToSteamRunning && handleAddToSteam(addToSteamSourceId)}
                    onClick={() => !addToSteamRunning && handleAddToSteam(addToSteamSourceId)}
                    focusClassName="is-focused"
                    style={{
                      margin: "6px 2px 0",
                      padding: "5px 10px",
                      borderRadius: "4px",
                      cursor: addToSteamRunning ? "default" : "pointer",
                      fontSize: "0.82em",
                      border: "1px solid #27ae60",
                      color: "#2ecc71",
                      background: "#1a3a1a",
                      textAlign: "center" as const,
                      opacity: addToSteamRunning ? 0.5 : 1,
                    }}
                  >
                    {addToSteamRunning ? "Starting…" : "Confirm Add to Steam"}
                  </Focusable>
                )}
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: "1px solid #2a2a2a", margin: "2px 10px" }} />

            {/* Apply Games Art */}
            <Focusable
              onActivate={() => !applyArtRunning && setShowApplyArtConfirm((v) => !v)}
              onClick={() => !applyArtRunning && setShowApplyArtConfirm((v) => !v)}
              focusClassName="is-focused"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "0 2px",
                padding: "7px 10px",
                cursor: applyArtRunning ? "default" : "pointer",
                fontSize: "0.85em",
                borderRadius: "4px",
                color: applyArtRunning ? "#555" : "#e0e0e0",
                opacity: applyArtRunning ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!applyArtRunning) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
              </svg>
              {applyArtRunning ? "Applying art…" : "Apply Games Art"}
            </Focusable>

            {showApplyArtConfirm && (
              <div style={{ margin: "2px 10px 6px", padding: "8px", background: "#1a1a1a", borderRadius: "4px", border: "1px solid #2a2a2a" }}>
                <div style={{ fontSize: "0.78em", color: "#e0a800", marginBottom: "8px" }}>
                  This will overwrite existing art for all games with a SteamGridDB ID configured, replacing it with the default first result from SteamGridDB.
                </div>
                <Focusable focusClassName="" style={{ display: "flex", gap: "6px" }}>
                  <Focusable
                    onActivate={() => { setShowApplyArtConfirm(false); handleApplyGamesArt(); }}
                    onClick={() => { setShowApplyArtConfirm(false); handleApplyGamesArt(); }}
                    focusClassName="is-focused"
                    style={{ margin: "0 2px", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "0.82em", border: "1px solid #27ae60", color: "#2ecc71", background: "#1a3a1a", flex: 1, textAlign: "center" as const }}
                  >
                    Confirm
                  </Focusable>
                  <Focusable
                    onActivate={() => setShowApplyArtConfirm(false)}
                    onClick={() => setShowApplyArtConfirm(false)}
                    focusClassName="is-focused"
                    style={{ margin: "0 2px", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "0.82em", border: "1px solid #555", color: "#aaa", background: "transparent", flex: 1, textAlign: "center" as const }}
                  >
                    Cancel
                  </Focusable>
                </Focusable>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Search + Filter row */}
      <Focusable
        focusClassName=""
        style={{ display: "flex", gap: "6px", marginBottom: showFilterDialog ? "4px" : "12px", alignItems: "center" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Games"
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={() => setShowFilterDialog((v) => !v)}
          onClick={() => setShowFilterDialog((v) => !v)}
          focusClassName="is-focused"
          style={{
            ...BTN,
            padding: "6px 9px",
            border: (showFilterDialog || activeFilterCount > 0) ? "1px solid #3498db" : "1px solid #555",
            color: (showFilterDialog || activeFilterCount > 0) ? "#5dade2" : "#e0e0e0",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
            <path d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z" />
          </svg>
          {activeFilterCount > 0 && (
            <span style={{
              position: "absolute", top: "-4px", right: "-4px",
              background: "#3498db", color: "#fff",
              borderRadius: "50%", fontSize: "0.65em",
              width: "14px", height: "14px",
              display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1,
            }}>
              {activeFilterCount}
            </span>
          )}
        </Focusable>
        {hasActiveFilters && (
          <Focusable
            onActivate={clearFilters}
            onClick={clearFilters}
            focusClassName="is-focused"
            style={{ ...BTN, padding: "6px 9px", border: "1px solid #555", color: "#aaa", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </Focusable>
        )}
        {artEnabled && (
          <Focusable
            onActivate={() => setViewMode((m) => { const next = m === "card" ? "list" : "card"; setViewModeBackend(next).catch(() => {}); return next; })}
            onClick={() => setViewMode((m) => { const next = m === "card" ? "list" : "card"; setViewModeBackend(next).catch(() => {}); return next; })}
            focusClassName="is-focused"
            title={viewMode === "card" ? "Switch to list view" : "Switch to card view"}
            style={{ ...BTN, padding: "6px 9px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {viewMode === "card" ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zm0-10v2h14V7H7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ display: "block" }}>
                <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" />
              </svg>
            )}
          </Focusable>
        )}
      </Focusable>

      {/* Filter dialog */}
      {showFilterDialog && (
        <div style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "12px" }}>
          {/* Sources */}
          {allSources.length > 0 && (
            <>
              <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Sources
              </div>
              <Focusable
                focusClassName=""
                style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}
              >
                {allSources.map((src) => (
                  <Focusable
                    key={src.id}
                    onActivate={() => toggleSourceFilter(src.id)}
                    onClick={() => toggleSourceFilter(src.id)}
                    focusClassName="is-focused"
                    style={CHIP(filterSourceIds.has(src.id))}
                  >
                    {src.name}
                  </Focusable>
                ))}
              </Focusable>
            </>
          )}

          {/* Collections */}
          {allCollections.length > 0 && (
            <>
              <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Collections
              </div>
              <Focusable
                focusClassName=""
                style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}
              >
                {allCollections.map((col) => (
                  <Focusable
                    key={col}
                    onActivate={() => toggleCollectionFilter(col)}
                    onClick={() => toggleCollectionFilter(col)}
                    focusClassName="is-focused"
                    style={CHIP(filterCollections.has(col))}
                  >
                    {col}
                  </Focusable>
                ))}
              </Focusable>
            </>
          )}

          {/* Steam status */}
          <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Steam Status
          </div>
          <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
            {(["all", "in-steam", "not-in-steam"] as const).map((opt) => (
              <Focusable
                key={opt}
                onActivate={() => setFilterSteamStatus(opt)}
                onClick={() => setFilterSteamStatus(opt)}
                focusClassName="is-focused"
                style={CHIP(filterSteamStatus === opt)}
              >
                {opt === "all" ? "— All —" : opt === "in-steam" ? "In Steam" : "Not in Steam"}
              </Focusable>
            ))}
          </Focusable>
        </div>
      )}

      {/* Game list */}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && games.length === 0 && (
        <div style={{ padding: "24px 16px", textAlign: "center", color: "#aaa" }}>
          {xferSources.length === 0 ? (
            <>
              <div style={{ fontSize: "2em", marginBottom: "8px" }}>🎮</div>
              <div style={{ fontWeight: "bold", color: "#eee", marginBottom: "6px" }}>Welcome to Deckyfin</div>
              <div style={{ fontSize: "0.82em", marginBottom: "16px", lineHeight: 1.5 }}>
                Deckyfin lets you play your Windows games stored on a local drive or home server — without moving files to the SSD.
              </div>
              <div style={{ fontSize: "0.8em", textAlign: "left", marginBottom: "16px", lineHeight: 1.8, background: "#1a1a1a", borderRadius: "6px", padding: "10px 14px" }}>
                <div>1. Open <strong>Settings → Sources</strong> and add your games folder</div>
                <div>2. Tap <strong>Rescan</strong> on the source to detect games</div>
                <div>3. Open a game, set the executable and Proton version</div>
                <div>4. Tap <strong>Add to Steam</strong> — done</div>
              </div>
              <Focusable
                focusClassName="is-focused"
                onActivate={() => { saveUiState({ view: "settings" }).catch(() => {}); setView("settings"); }}
                onClick={() => { saveUiState({ view: "settings" }).catch(() => {}); setView("settings"); }}
                style={{ display: "inline-block", padding: "6px 20px", borderRadius: "4px", background: "#0078d4", color: "white", fontSize: "0.85em", cursor: "pointer", border: "none" }}
              >
                Go to Settings
              </Focusable>
            </>
          ) : (
            <>
              <div style={{ fontSize: "1.6em", marginBottom: "8px" }}>📂</div>
              <div style={{ fontWeight: "bold", color: "#eee", marginBottom: "6px" }}>No games found</div>
              <div style={{ fontSize: "0.82em", lineHeight: 1.5 }}>
                You have {xferSources.length} source{xferSources.length !== 1 ? "s" : ""} configured. Open <strong>Settings → Sources</strong> and tap <strong>Rescan</strong> on each source to detect games.
              </div>
            </>
          )}
        </div>
      )}
      {viewMode === "card" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "8px",
          }}
        >
          {filteredGames.map((game) => (
            <GameCard
              key={game.id}
              game={game.sources[0]?.config ?? { name: game.name, executable: "" }}
              isInSteam={steamNames.has(game.name)}
              sourceCount={game.sources.length}
              onClick={() => openGame(game)}
              artEnabled={artEnabled}
            />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {filteredGames.map((game) => (
            <Focusable
              key={game.id}
              onActivate={() => openGame(game)}
              onClick={() => openGame(game)}
              focusClassName="is-focused"
              style={{
                padding: "8px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent",
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = "0 0 0 3px #51cbf8, 0 0 12px rgba(81,203,248,0.4)")}
              onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>{game.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {game.sources.length > 1 && (
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(0,120,212,0.25)", color: "#74b9ff" }}>
                    {game.sources.length} sources
                  </span>
                )}
                {steamNames.has(game.name) && (
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="#c7d5e0">
                    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
                  </svg>
                )}
              </div>
            </Focusable>
          ))}
        </div>
      )}
    </div>
  );
};
