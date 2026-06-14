import { VFC, useState, useEffect, useRef, useCallback } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { Source } from "../types";
import { CompactTextField } from "../components/CompactTextField";

const GUIDES_BASE = "https://github.com/avivkilloz/deckyfin/blob/feature/multi-source/guides";
const SOURCE_GUIDE_URLS: Record<string, string> = {
  local: `${GUIDES_BASE}/source-local.md`,
  mount: `${GUIDES_BASE}/source-mount.md`,
  agent: `${GUIDES_BASE}/source-agent.md`,
};

const listSources = callable<[], Source[]>("list_sources");
const listSubfolders = callable<[path: string], string[]>("list_subfolders");
const addSource = callable<
  [name: string, type: string, path: string | null, url: string | null],
  { success: boolean; source?: Source; error?: string }
>("add_source");
const removeSource = callable<[source_id: string], { success: boolean }>("remove_source");
const getSourceDiskUsage = callable<[source_id: string], { used: number | null; total: number | null; free: number | null }>("get_source_disk_usage");
const initializeSource = callable<[source_id: string], { success: boolean; message?: string }>("initialize_source");
const listActiveTransfers = callable<
  [],
  import("../types").TransferStatus[]
>("list_active_transfers");

const getMaxParallelTransfers = callable<[], number>("get_max_parallel_transfers");
const setMaxParallelTransfers = callable<[value: number], { success: boolean; value: number }>("set_max_parallel_transfers");
const getPopularDeps = callable<[], string[]>("get_popular_deps");
const setPopularDeps = callable<[deps: string[]], { success: boolean }>("set_popular_deps");
const listProtonSources = callable<[], { id: string; name: string; repo: string }[]>("list_proton_sources");
const fetchProtonReleases = callable<
  [source_id: string, page: number, per_page: number],
  { source_id: string; releases: { tag_name: string; install_name: string; size_bytes: number; download_url: string; installed: boolean }[]; has_more: boolean }
>("fetch_proton_releases");
const startProtonInstall = callable<[install_name: string, download_url: string], { success: boolean; error: string | null }>("start_proton_install");
const cancelProtonInstall = callable<[install_name: string], { success: boolean; error: string | null }>("cancel_proton_install");
const deleteProtonVersion = callable<[install_name: string], { success: boolean; error: string | null }>("delete_proton_version");
const getProtonInstallStatuses = callable<[], Record<string, { status: string; bytes_downloaded: number; total_bytes: number; error: string | null }>>("get_proton_install_statuses");
const listSteamCollections = callable<[], string[]>("list_steam_collections");
const createSteamCollection = callable<[name: string], { success: boolean; error: string | null }>("create_steam_collection");
const deleteSteamCollection = callable<[name: string], { success: boolean; error: string | null }>("delete_steam_collection");

const getSteamGridKey = callable<[], { key: string; has_override: boolean }>(
  "get_steamgrid_key"
);
const setSteamGridKey = callable<
  [key: string],
  { success: boolean }
>("set_steamgrid_key");
const getProtontricksStatus = callable<
  [],
  { flatpak_available: boolean; flatpak_installed: boolean; native_available: boolean; status: string }
>("get_protontricks_status");
const installProtontricks = callable<
  [],
  { success: boolean; message: string }
>("install_protontricks");

interface Props {
  onBack: () => void;
}

const BTN_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "0.85em",
  cursor: "pointer",
  borderRadius: "4px",
  border: "1px solid #555",
  background: "transparent",
  color: "#e0e0e0",
};

export const SettingsPage: VFC<Props> = ({ onBack }) => {
  const backRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus Back button on mount so B-button works immediately ──
  useEffect(() => {
    const timer = setTimeout(() => backRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // ── Transfer settings ─────────────────────────────────────────────────────
  const [maxParallel, setMaxParallel] = useState(1);

  useEffect(() => {
    getMaxParallelTransfers().then((v) => setMaxParallel(v ?? 1)).catch(() => {});
  }, []);

  const handleSetMaxParallel = async (v: number) => {
    setMaxParallel(v);
    await setMaxParallelTransfers(v).catch(() => {});
  };

  // ── Popular dependencies ──────────────────────────────────────────────────
  const [popularDeps, setPopularDepsState] = useState<string[]>([]);
  const [newDep, setNewDep] = useState("");

  useEffect(() => {
    getPopularDeps().then((d) => setPopularDepsState(d || [])).catch(() => {});
  }, []);

  const handleRemoveDep = async (dep: string) => {
    const next = popularDeps.filter((d) => d !== dep);
    setPopularDepsState(next);
    await setPopularDeps(next).catch(() => {});
  };

  const handleAddDep = async () => {
    const trimmed = newDep.trim().toLowerCase();
    if (!trimmed || popularDeps.includes(trimmed)) { setNewDep(""); return; }
    const next = [...popularDeps, trimmed];
    setPopularDepsState(next);
    setNewDep("");
    await setPopularDeps(next).catch(() => {});
  };

  // ── Steam Collections ──────────────────────────────────────────────────────
  const [steamCollections, setSteamCollections] = useState<string[]>([]);
  const [newCollection, setNewCollection] = useState("");
  const [collectionMsg, setCollectionMsg] = useState<string | null>(null);

  useEffect(() => {
    listSteamCollections().then((c) => setSteamCollections(c || [])).catch(() => {});
  }, []);

  const handleAddCollection = async () => {
    const trimmed = newCollection.trim();
    if (!trimmed) return;
    try {
      const res = await createSteamCollection(trimmed);
      if (res.success) {
        setSteamCollections((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed].sort());
        setNewCollection("");
        setCollectionMsg(null);
      } else {
        setCollectionMsg(`❌ ${res.error || "Failed"}`);
      }
    } catch (err: any) {
      setCollectionMsg(`❌ ${err?.message || "Failed"}`);
    }
  };

  const handleRemoveCollection = async (name: string) => {
    try {
      const res = await deleteSteamCollection(name);
      if (res.success) {
        setSteamCollections((prev) => prev.filter((c) => c !== name));
        setCollectionMsg(null);
      } else {
        setCollectionMsg(`❌ ${res.error || "Failed"}`);
      }
    } catch (err: any) {
      setCollectionMsg(`❌ ${err?.message || "Failed"}`);
    }
  };

  // ── Proton multi-source releases ─────────────────────────────────────────
  type ProtonRelease = { tag_name: string; install_name: string; size_bytes: number; download_url: string; installed: boolean };
  type InstallStatus = { status: string; bytes_downloaded: number; total_bytes: number; error: string | null };
  type ProtonSource = { id: string; name: string; repo: string };
  type SourceState = { releases: ProtonRelease[]; loading: boolean; error: string | null; hasMore: boolean; page: number; expanded: boolean };

  const [protonSources, setProtonSources] = useState<ProtonSource[]>([]);
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({});
  const [installStatuses, setInstallStatuses] = useState<Record<string, InstallStatus>>({});
  const [protonError, setProtonError] = useState<string | null>(null);

  const PER_PAGE = 10;

  const setSourceState = (id: string, patch: Partial<SourceState>) =>
    setSourceStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const loadReleasesPage = useCallback(async (sourceId: string, page: number) => {
    setSourceState(sourceId, { loading: true, error: null });
    try {
      const res = await fetchProtonReleases(sourceId, page, PER_PAGE);
      setSourceStates((prev) => {
        const existing = prev[sourceId]?.releases || [];
        const merged = page === 1 ? (res.releases || []) : [...existing, ...(res.releases || [])];
        return { ...prev, [sourceId]: { ...prev[sourceId], releases: merged, loading: false, error: null, hasMore: res.has_more, page } };
      });
    } catch (err: any) {
      setSourceState(sourceId, { loading: false, error: err?.message || "Failed to fetch releases" });
    }
  }, []);

  // On mount: load sources + restore active install states + fetch page 1 for each
  useEffect(() => {
    getProtonInstallStatuses().then((s) => setInstallStatuses(s || {})).catch(() => {});
    listProtonSources().then((sources) => {
      setProtonSources(sources || []);
      const initial: Record<string, SourceState> = {};
      (sources || []).forEach((src) => {
        initial[src.id] = { releases: [], loading: false, error: null, hasMore: false, page: 1, expanded: false };
      });
      setSourceStates(initial);
      (sources || []).forEach((src) => loadReleasesPage(src.id, 1));
    }).catch((err: any) => setProtonError(err?.message || "Failed to load Proton sources"));
  }, [loadReleasesPage]);

  // Poll install statuses while any download is active
  useEffect(() => {
    const hasActive = Object.values(installStatuses).some(
      (s) => s.status === "downloading" || s.status === "extracting"
    );
    if (!hasActive) return;
    const id = setInterval(async () => {
      try {
        const statuses = await getProtonInstallStatuses();
        setInstallStatuses(statuses || {});
        const justDone = Object.entries(statuses || {}).filter(([, s]) => s.status === "done").map(([k]) => k);
        if (justDone.length > 0) {
          // Refresh all source release lists to pick up newly installed entries
          protonSources.forEach((src) => {
            setSourceStates((prev) => {
              const updated = (prev[src.id]?.releases || []).map((r) =>
                justDone.includes(r.install_name) ? { ...r, installed: true } : r
              );
              return { ...prev, [src.id]: { ...prev[src.id], releases: updated } };
            });
          });
        }
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, [installStatuses, protonSources]);

  const handleInstallProton = async (install_name: string, download_url: string) => {
    try {
      const res = await startProtonInstall(install_name, download_url);
      if (!res.success) { setProtonError(res.error || "Failed to start"); return; }
      setInstallStatuses((prev) => ({
        ...prev,
        [install_name]: { status: "downloading", bytes_downloaded: 0, total_bytes: 0, error: null },
      }));
    } catch (err: any) {
      setProtonError(err?.message || "Failed");
    }
  };

  const handleCancelProton = async (install_name: string) => {
    try { await cancelProtonInstall(install_name); } catch {}
    setInstallStatuses((prev) => { const n = { ...prev }; delete n[install_name]; return n; });
  };

  const handleDeleteProton = async (sourceId: string, install_name: string) => {
    try {
      const res = await deleteProtonVersion(install_name);
      if (res.success) {
        setSourceStates((prev) => ({
          ...prev,
          [sourceId]: {
            ...prev[sourceId],
            releases: (prev[sourceId]?.releases || []).map((r) =>
              r.install_name === install_name ? { ...r, installed: false } : r
            ),
          },
        }));
      } else {
        setProtonError(res.error || "Delete failed");
      }
    } catch (err: any) {
      setProtonError(err?.message || "Failed");
    }
  };

  // ── Sources state ─────────────────────────────────────────────────────────
  const [sources, setSources] = useState<Source[]>([]);
  const [diskUsages, setDiskUsages] = useState<Record<string, { used: number | null; total: number | null; free: number | null }>>({});
  const [activeTransfers, setActiveTransfers] = useState<import("../types").TransferStatus[]>([]);
  const [sourceMessage, setSourceMessage] = useState<{ id: string; msg: string } | null>(null);

  // Add source form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<"local" | "mount" | "agent">("local");
  const [newSourcePath, setNewSourcePath] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [addSourceMsg, setAddSourceMsg] = useState<string | null>(null);

  // Folder browser for path selection
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("/");
  const [browserItems, setBrowserItems] = useState<string[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);

  const browseTo = async (path: string) => {
    setBrowserLoading(true);
    try {
      const items = await listSubfolders(path);
      setBrowserPath(path);
      setBrowserItems(Array.isArray(items) ? items : []);
    } catch {
      setBrowserItems([]);
    }
    setBrowserLoading(false);
  };

  const handleOpenFolderBrowser = async () => {
    if (showFolderBrowser) {
      setShowFolderBrowser(false);
      return;
    }
    await browseTo(newSourcePath || "/");
    setShowFolderBrowser(true);
  };

  const handleBrowserUp = () => {
    if (browserPath === "/") return;
    const parent = browserPath.substring(0, browserPath.lastIndexOf("/")) || "/";
    browseTo(parent);
  };

  const handleBrowserEnter = (dir: string) => {
    const next = browserPath === "/" ? `/${dir}` : `${browserPath}/${dir}`;
    browseTo(next);
  };

  const handleBrowserSelect = () => {
    setNewSourcePath(browserPath);
    setShowFolderBrowser(false);
  };

  const loadSources = useCallback(async () => {
    try {
      const s = await listSources();
      setSources(s || []);
      for (const src of s || []) {
        getSourceDiskUsage(src.id)
          .then((usage) => setDiskUsages((prev) => ({ ...prev, [src.id]: usage })))
          .catch(() => {});
      }
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
    listActiveTransfers().then(setActiveTransfers).catch(() => {});
  }, [loadSources]);

  const handleAddSource = async () => {
    setAddSourceMsg(null);
    const path = newSourceType !== "agent" ? newSourcePath || null : null;
    const url = newSourceType === "agent" ? newSourceUrl || null : null;
    if (!newSourceName.trim()) { setAddSourceMsg("❌ Name is required"); return; }
    if (newSourceType !== "agent" && !path) { setAddSourceMsg("❌ Path is required"); return; }
    if (newSourceType === "agent" && !url) { setAddSourceMsg("❌ URL is required"); return; }
    try {
      const res = await addSource(newSourceName, newSourceType, path, url);
      if (res.success) {
        setShowAddForm(false);
        setNewSourceName(""); setNewSourcePath(""); setNewSourceUrl("");
        await loadSources();
      } else {
        setAddSourceMsg(`❌ ${res.error || "Failed"}`);
      }
    } catch (err: any) {
      setAddSourceMsg(`❌ ${err?.message || "Failed"}`);
    }
  };

  const handleRemoveSource = async (source_id: string) => {
    try {
      await removeSource(source_id);
      await loadSources();
    } catch {}
  };

  const handleRescanSource = async (source_id: string) => {
    try {
      const res = await initializeSource(source_id);
      setSourceMessage({ id: source_id, msg: res.success ? "✅ Rescanned" : "❌ Failed" });
      setTimeout(() => setSourceMessage(null), 3000);
    } catch {}
  };

  // ── SteamGridDB key ──────────────────────────────────────────────────
  const [sgKey, setSgKey] = useState("");
  const [sgHasOverride, setSgHasOverride] = useState(false);
  const [sgMessage, setSgMessage] = useState<string | null>(null);

  useEffect(() => {
    getSteamGridKey()
      .then((res) => {
        setSgKey(res.has_override ? res.key : "");
        setSgHasOverride(res.has_override);
      })
      .catch(() => {});
  }, []);

  const handleSaveKey = async () => {
    setSgMessage(null);
    try {
      await setSteamGridKey(sgKey);
      setSgHasOverride(true);
      setSgMessage("✅ API key saved");
    } catch (err: any) {
      setSgMessage(`❌ ${err?.message || "Failed to save"}`);
    }
  };

  // ── End SteamGridDB ──────────────────────────────────────────────────

  // ── Protontricks Status ─────────────────────────────────────────────
  const [ptStatus, setPtStatus] = useState<{
    flatpak_available: boolean;
    flatpak_installed: boolean;
    native_available: boolean;
    status: string;
  } | null>(null);
  const [ptInstalling, setPtInstalling] = useState(false);
  const [ptMessage, setPtMessage] = useState<string | null>(null);

  const loadPtStatus = useCallback(async () => {
    try {
      const s = await getProtontricksStatus();
      setPtStatus(s);
    } catch {
      setPtStatus(null);
    }
  }, []);

  useEffect(() => {
    loadPtStatus();
  }, [loadPtStatus]);

  const handleInstallProto = async () => {
    setPtInstalling(true);
    setPtMessage(null);
    try {
      const res = await installProtontricks();
      if (res.success) {
        setPtMessage("✅ Protontricks installed");
        await loadPtStatus(); // Refresh status
      } else {
        setPtMessage(`❌ ${res.message}`);
      }
    } catch (err: any) {
      setPtMessage(`❌ ${err?.message || "Install failed"}`);
    }
    setPtInstalling(false);
  };
  // ── End Protontricks ────────────────────────────────────────────────

  return (
    <Focusable
      onCancel={onBack}
      onCancelButton={onBack}
      focusClassName="is-focused"
      style={{ padding: "8px" }}
    >
      <Focusable
        ref={backRef}
        onActivate={onBack}
        onClick={onBack}
        focusClassName="is-focused"
        style={{
          ...BTN_STYLE,
          padding: "6px 10px",
          fontSize: "0.82em",
          display: "inline-block",
          marginBottom: "12px",
        }}
      >
        Back
      </Focusable>
      <h3 style={{ margin: "0 0 10px 0" }}>Settings</h3>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h4 style={{ margin: 0 }}>Sources</h4>
        <Focusable
          onActivate={() => setShowAddForm((v) => !v)}
          onClick={() => setShowAddForm((v) => !v)}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, fontSize: "0.82em", padding: "4px 10px", borderColor: "#0078d4", color: "#0078d4" }}
        >
          {showAddForm ? "✕ Cancel" : "+ Add Source"}
        </Focusable>
      </div>

      {/* Add source form */}
      {showAddForm && (
        <div style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "10px" }}>
          <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Name</div>
          <CompactTextField value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} style={{ width: "100%", marginBottom: "8px" }} />
          <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Type</div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px", alignItems: "center" }}>
            {(["local", "mount", "agent"] as const).map((t) => (
              <Focusable key={t} onActivate={() => setNewSourceType(t)} onClick={() => setNewSourceType(t)} focusClassName="is-focused"
                style={{ padding: "3px 10px", fontSize: "0.82em", borderRadius: "12px", cursor: "pointer",
                  border: newSourceType === t ? "1px solid #0078d4" : "1px solid #555",
                  background: newSourceType === t ? "#0078d4" : "transparent",
                  color: newSourceType === t ? "white" : "#ccc" }}>
                {t}
              </Focusable>
            ))}
            <Focusable
              focusClassName="is-focused"
              onActivate={() => Navigation.NavigateToExternalWeb(SOURCE_GUIDE_URLS[newSourceType])}
              onClick={() => Navigation.NavigateToExternalWeb(SOURCE_GUIDE_URLS[newSourceType])}
              style={{ padding: "3px 7px", fontSize: "0.85em", borderRadius: "12px", cursor: "pointer", border: "1px solid #555", color: "#888", lineHeight: 1 }}
            >
              ℹ
            </Focusable>
          </div>
          {newSourceType !== "agent" ? (
            <>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Path</div>
              <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: showFolderBrowser ? "4px" : "8px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CompactTextField value={newSourcePath} onChange={(e) => setNewSourcePath(e.target.value)} placeholder="/home/deck/Games" style={{ width: "100%" }} />
                </div>
                <Focusable onActivate={handleOpenFolderBrowser} onClick={handleOpenFolderBrowser} focusClassName="is-focused"
                  style={{ ...BTN_STYLE, padding: "4px 12px", alignSelf: "center" }}>
                  {showFolderBrowser ? "✕" : "Browse"}
                </Focusable>
              </Focusable>

              {showFolderBrowser && (
                <div style={{ border: "1px solid #555", borderRadius: "4px", marginBottom: "8px" }}>
                  {/* Header: up + current path + select */}
                  <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", padding: "5px 8px", borderBottom: "1px solid #444" }}>
                    <Focusable onActivate={handleBrowserUp} onClick={handleBrowserUp} focusClassName="is-focused"
                      style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", opacity: browserPath === "/" ? 0.4 : 1 }}>
                      ← Up
                    </Focusable>
                    <span style={{ flex: 1, fontSize: "0.78em", color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {browserPath}
                    </span>
                    <Focusable onActivate={handleBrowserSelect} onClick={handleBrowserSelect} focusClassName="is-focused"
                      style={{ ...BTN_STYLE, padding: "2px 8px", fontSize: "0.82em", borderColor: "#27ae60", color: "#2ecc71" }}>
                      ✓ Select
                    </Focusable>
                  </Focusable>
                  {/* Directory listing */}
                  <Focusable focusClassName="" style={{ maxHeight: "180px", overflowY: "auto" }}>
                    {browserLoading && (
                      <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>Loading…</p>
                    )}
                    {!browserLoading && browserItems.length === 0 && (
                      <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>No subdirectories</p>
                    )}
                    {browserItems.map((dir) => (
                      <Focusable key={dir} onActivate={() => handleBrowserEnter(dir)} onClick={() => handleBrowserEnter(dir)} focusClassName="is-focused"
                        style={{ margin: "0 2px", padding: "4px 10px", fontSize: "0.85em", cursor: "pointer", borderBottom: "1px solid #333" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        📁 {dir}
                      </Focusable>
                    ))}
                  </Focusable>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>URL</div>
              <CompactTextField value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} placeholder="http://10.0.0.1:8080" style={{ width: "100%", marginBottom: "8px" }} />
            </>
          )}
          <Focusable onActivate={handleAddSource} onClick={handleAddSource} focusClassName="is-focused"
            style={{ ...BTN_STYLE, borderColor: "#27ae60", color: "#2ecc71", display: "inline-block" }}>
            Add
          </Focusable>
          {addSourceMsg && <span style={{ marginLeft: "8px", fontSize: "0.82em", color: "tomato" }}>{addSourceMsg}</span>}
        </div>
      )}

      {/* Source list */}
      {sources.length === 0 && !showAddForm && (
        <p style={{ fontSize: "0.85em", color: "#888" }}>No sources configured. Add one above.</p>
      )}
      {sources.map((src) => {
        const usage = diskUsages[src.id];
        const usedPct = usage?.total ? Math.round((usage.used! / usage.total) * 100) : null;
        const typeColor = src.type === "local" ? "#27ae60" : src.type === "mount" ? "#e67e22" : "#0984e3";
        const typeBg = src.type === "local" ? "#1a3a1a" : src.type === "mount" ? "#2a2a1a" : "#1a1a3a";
        const offline = !usage?.total && usage?.total !== undefined;
        return (
          <div key={src.id} style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "8px", opacity: offline ? 0.7 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div>
                <span style={{ fontWeight: 600, color: "#e0e0e0" }}>{src.name}</span>
                {offline && <span style={{ marginLeft: "6px", fontSize: "0.75em", color: "#e74c3c" }}>⚠ offline</span>}
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <Focusable onActivate={() => handleRescanSource(src.id)} onClick={() => handleRescanSource(src.id)} focusClassName="is-focused"
                  style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px" }}>
                  {sourceMessage?.id === src.id ? sourceMessage.msg : "Rescan"}
                </Focusable>
                <Focusable onActivate={() => handleRemoveSource(src.id)} onClick={() => handleRemoveSource(src.id)} focusClassName="is-focused"
                  style={{ ...BTN_STYLE, fontSize: "0.75em", padding: "2px 8px", borderColor: "#c0392b", color: "#e74c3c" }}>
                  Remove
                </Focusable>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
              <span style={{ padding: "2px 7px", fontSize: "0.75em", borderRadius: "10px", background: typeBg, color: typeColor, border: `1px solid ${typeColor}` }}>{src.type}</span>
            </div>
            <div style={{ fontSize: "0.78em", color: "#666", marginBottom: "6px" }}>{src.path || src.url}</div>
            {usedPct !== null && (
              <>
                <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "3px", display: "flex", justifyContent: "space-between" }}>
                  <span>Disk</span>
                  <span>{Math.round(usage!.used! / 1e9)} GB / {Math.round(usage!.total! / 1e9)} GB</span>
                </div>
                <div style={{ height: "5px", background: "#333", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${usedPct}%`, height: "100%", background: typeColor, borderRadius: "3px" }} />
                </div>
              </>
            )}
            {offline && <div style={{ fontSize: "0.75em", color: "#555" }}>Disk info unavailable</div>}
            {(() => {
              const xfer = activeTransfers.find(
                (t) => t.to_source_id === src.id && t.status === "running",
              );
              if (!xfer) return null;
              const pct =
                xfer.total_bytes > 0
                  ? Math.round((xfer.bytes_copied / xfer.total_bytes) * 100)
                  : 0;
              return (
                <div style={{ fontSize: "0.75em", color: "#e67e22", marginTop: "4px" }}>
                  ⟳ Receiving {xfer.game_name}… {pct}%
                </div>
              );
            })()}
          </div>
        );
      })}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── SteamGridDB API Key ──────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>SteamGridDB API Key</h4>

      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        A default key is bundled. Set a custom one here to override it.
        Get your own free key{" "}
        <Focusable
          onActivate={() =>
            Navigation.NavigateToExternalWeb("https://www.steamgriddb.com/profile/preferences/api")
          }
          onClick={() =>
            Navigation.NavigateToExternalWeb("https://www.steamgriddb.com/profile/preferences/api")
          }
          focusClassName="is-focused"
          style={{ color: "#0078d4", textDecoration: "underline", cursor: "pointer", display: "inline" }}
        >
          here
        </Focusable>
        .
      </p>
      <CompactTextField
        value={sgKey}
        onChange={(e) => setSgKey(e.target.value)}
        style={{ width: "100%", marginBottom: "8px" }}
      />

      <Focusable
        onActivate={handleSaveKey}
        onClick={handleSaveKey}
        focusClassName="is-focused"
        style={{ ...BTN_STYLE, display: "inline-block", marginBottom: "8px" }}
      >
        Save Key
      </Focusable>

      {sgHasOverride && (
        <span style={{ display: "block", fontSize: "0.8em", color: "#f0ad4e", marginBottom: "4px" }}>
          (custom key active)
        </span>
      )}

      {sgMessage && (
        <p style={{ marginTop: "4px", fontSize: "0.9em", color: sgMessage.startsWith("✅") ? "lightgreen" : "tomato" }}>
          {sgMessage}
        </p>
      )}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Protontricks ─────────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Protontricks</h4>

      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Protontricks installs Windows DLLs (VC++, DirectX, .NET) into Proton game prefixes. On Steam Deck, flatpak is the only option.
      </p>

      {ptStatus ? (
        <div style={{ fontSize: "0.85em", marginBottom: "10px" }}>
          {ptStatus.flatpak_installed && (
            <div>
              <span>✅</span>{" "}
              <span style={{ color: "#e0e0e0" }}>Protontricks (flatpak)</span>
            </div>
          )}
          {!ptStatus.flatpak_installed && ptStatus.native_available && (
            <div>
              <span>✅</span>{" "}
              <span style={{ color: "#e0e0e0" }}>Protontricks (native)</span>
            </div>
          )}
          {!ptStatus.flatpak_installed && !ptStatus.native_available && (
            <p style={{ color: "#888", margin: 0 }}>Not installed</p>
          )}
        </div>
      ) : (
        <p style={{ fontSize: "0.85em", color: "#888", marginBottom: "10px" }}>Checking…</p>
      )}

      {ptStatus && ptStatus.flatpak_available && !ptStatus.flatpak_installed && !ptStatus.native_available && (
        <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px" }}>
          <Focusable
            onActivate={handleInstallProto}
            onClick={handleInstallProto}
            focusClassName="is-focused"
            style={{
              ...BTN_STYLE,
              border: "1px solid #0078d4",
              color: "#0078d4",
              opacity: ptInstalling ? 0.6 : 1,
            }}
          >
            {ptInstalling ? "Installing…" : "Install Protontricks (flatpak)"}
          </Focusable>
        </div>
      )}

      {ptMessage && (
        <p style={{ marginTop: "8px", fontSize: "0.9em", color: ptMessage.startsWith("✅") ? "lightgreen" : "tomato" }}>
          {ptMessage}
        </p>
      )}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Popular Dependencies ─────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 6px 0" }}>Popular Dependencies</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        These appear as quick-toggle chips on each game's dependency section.
      </p>
      <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
        {popularDeps.map((dep) => (
          <Focusable
            key={dep}
            onActivate={() => handleRemoveDep(dep)}
            onClick={() => handleRemoveDep(dep)}
            focusClassName="is-focused"
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "3px 10px", borderRadius: "14px", fontSize: "0.82em",
              border: "1px solid #555", color: "#ccc", cursor: "pointer",
            }}
          >
            {dep}
            <span style={{ color: "#888", fontSize: "0.85em" }}>✕</span>
          </Focusable>
        ))}
      </Focusable>
      <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={newDep}
            onChange={(e) => setNewDep(e.target.value)}
            placeholder="Add winetricks verb…"
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={handleAddDep}
          onClick={handleAddDep}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, padding: "6px 12px", whiteSpace: "nowrap" as const }}
        >
          Add
        </Focusable>
      </Focusable>

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Steam Collections ────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 6px 0" }}>Steam Collections</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Manage Steam collections. Adding creates the collection in Steam; removing deletes it.
      </p>
      <Focusable focusClassName="" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
        {steamCollections.map((col) => (
          <Focusable
            key={col}
            onActivate={() => handleRemoveCollection(col)}
            onClick={() => handleRemoveCollection(col)}
            focusClassName="is-focused"
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "3px 10px", borderRadius: "14px", fontSize: "0.82em",
              border: "1px solid #555", color: "#ccc", cursor: "pointer",
            }}
          >
            {col}
            <span style={{ color: "#888", fontSize: "0.85em" }}>✕</span>
          </Focusable>
        ))}
        {steamCollections.length === 0 && (
          <span style={{ fontSize: "0.82em", color: "#666" }}>No collections yet</span>
        )}
      </Focusable>
      <Focusable focusClassName="" style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            placeholder="Collection name…"
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={handleAddCollection}
          onClick={handleAddCollection}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, padding: "6px 12px", whiteSpace: "nowrap" as const }}
        >
          Add
        </Focusable>
      </Focusable>
      {collectionMsg && (
        <p style={{ margin: "4px 0 0", fontSize: "0.82em", color: "tomato" }}>{collectionMsg}</p>
      )}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Transfer ────────────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Transfer</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Max games copying at once. Extras wait in a queue.
      </p>
      <Focusable focusClassName="" style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        {[1, 2, 3, 4].map((n) => (
          <Focusable
            key={n}
            onActivate={() => handleSetMaxParallel(n)}
            onClick={() => handleSetMaxParallel(n)}
            focusClassName="is-focused"
            style={{
              ...BTN_STYLE,
              padding: "4px 14px",
              border: maxParallel === n ? "1px solid #0078d4" : "1px solid #555",
              color: maxParallel === n ? "#0078d4" : "#e0e0e0",
            }}
          >
            {n}
          </Focusable>
        ))}
      </Focusable>

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Proton Versions ──────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 6px 0" }}>Proton Versions</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Download Proton versions into Steam's compatibilitytools.d. Downloads run in the background — you can navigate away freely.
      </p>
      {protonError && <p style={{ fontSize: "0.82em", color: "tomato", marginBottom: "8px" }}>{protonError}</p>}

      {protonSources.map((src) => {
        const ss = sourceStates[src.id];
        if (!ss) return null;
        const installedCount = (ss.releases || []).filter((r) => r.installed || installStatuses[r.install_name]?.status === "done").length;
        const activeInstall = Object.entries(installStatuses).find(
          ([name, s]) => (s.status === "downloading" || s.status === "extracting") &&
            (ss.releases || []).some((r) => r.install_name === name)
        );

        return (
          <div key={src.id} style={{ border: "1px solid #3a3a3a", borderRadius: "6px", marginBottom: "12px" }}>
            {/* Source header — always visible, click to expand/collapse */}
            <Focusable
              onActivate={() => setSourceState(src.id, { expanded: !ss.expanded })}
              onClick={() => setSourceState(src.id, { expanded: !ss.expanded })}
              focusClassName="is-focused"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", cursor: "pointer", background: "#1e1e1e" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9em", color: "#e0e0e0" }}>{src.name}</span>
                {installedCount > 0 && (
                  <span style={{ fontSize: "0.75em", color: "#27ae60" }}>✓ {installedCount} installed</span>
                )}
                {activeInstall && (() => {
                  const [name, s] = activeInstall;
                  const pct = s.status === "downloading" && s.total_bytes > 0
                    ? Math.round((s.bytes_downloaded / s.total_bytes) * 100)
                    : null;
                  return (
                    <span style={{ fontSize: "0.75em", color: "#0078d4" }}>
                      ↓ {name} {pct !== null ? `${pct}%` : "extracting…"}
                    </span>
                  );
                })()}
              </div>
              <span style={{ fontSize: "0.78em", color: "#666" }}>{ss.expanded ? "▲" : "▼"}</span>
            </Focusable>

            {/* Expanded release list */}
            {ss.expanded && (
              <div style={{ padding: "8px 12px" }}>
                {ss.error && <p style={{ fontSize: "0.82em", color: "tomato", margin: "0 0 6px 0" }}>{ss.error}</p>}
                {!ss.loading && (ss.releases || []).length === 0 && !ss.error && (
                  <p style={{ fontSize: "0.82em", color: "#666", margin: "4px 0" }}>No releases found. Check internet connection.</p>
                )}

                {(ss.releases || []).map((release) => {
                  const install = installStatuses[release.install_name];
                  const isDownloading = install?.status === "downloading";
                  const isExtracting = install?.status === "extracting";
                  const isActive = isDownloading || isExtracting;
                  const isDone = install?.status === "done";
                  const isFailed = install?.status === "failed";
                  const installed = release.installed || isDone;
                  const pct = isDownloading && install.total_bytes > 0
                    ? Math.round((install.bytes_downloaded / install.total_bytes) * 100)
                    : 0;
                  const sizeMb = release.size_bytes > 0 ? `${(release.size_bytes / 1e6).toFixed(0)} MB` : "";

                  return (
                    <div key={release.install_name} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: "1px solid #2a2a2a" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "0.85em", color: installed ? "#e0e0e0" : "#aaa" }}>{release.tag_name}</span>
                        {sizeMb && <span style={{ marginLeft: "6px", fontSize: "0.72em", color: "#555" }}>{sizeMb}</span>}
                        {isFailed && <span style={{ marginLeft: "6px", fontSize: "0.72em", color: "tomato" }}>✕ {install.error || "Failed"}</span>}
                        {isActive && (
                          <div style={{ marginTop: "3px" }}>
                            <div style={{ height: "3px", background: "#333", borderRadius: "2px", overflow: "hidden" }}>
                              <div style={{ width: isExtracting ? "100%" : `${pct}%`, height: "100%", background: "#0078d4", borderRadius: "2px", transition: isExtracting ? "none" : "width 0.3s" }} />
                            </div>
                            <span style={{ fontSize: "0.7em", color: "#888", display: "block", marginTop: "1px" }}>
                              {isExtracting ? "Extracting…" : `${pct}%`}
                            </span>
                          </div>
                        )}
                      </div>

                      {installed && !isActive && (
                        <span style={{ fontSize: "0.7em", color: "#27ae60", border: "1px solid #27ae60", borderRadius: "10px", padding: "1px 6px", whiteSpace: "nowrap" as const }}>
                          ✓
                        </span>
                      )}

                      {isActive ? (
                        <Focusable onActivate={() => handleCancelProton(release.install_name)} onClick={() => handleCancelProton(release.install_name)} focusClassName="is-focused"
                          style={{ ...BTN_STYLE, fontSize: "0.72em", padding: "2px 8px", whiteSpace: "nowrap" as const, borderColor: "#c0392b", color: "#e74c3c" }}>
                          Cancel
                        </Focusable>
                      ) : installed ? (
                        <Focusable onActivate={() => handleDeleteProton(src.id, release.install_name)} onClick={() => handleDeleteProton(src.id, release.install_name)} focusClassName="is-focused"
                          style={{ ...BTN_STYLE, fontSize: "0.72em", padding: "2px 8px", whiteSpace: "nowrap" as const, borderColor: "#c0392b", color: "#e74c3c" }}>
                          Delete
                        </Focusable>
                      ) : (
                        <Focusable onActivate={() => handleInstallProton(release.install_name, release.download_url)} onClick={() => handleInstallProton(release.install_name, release.download_url)} focusClassName="is-focused"
                          style={{ ...BTN_STYLE, fontSize: "0.72em", padding: "2px 8px", whiteSpace: "nowrap" as const, borderColor: "#0078d4", color: "#0078d4" }}>
                          Download
                        </Focusable>
                      )}
                    </div>
                  );
                })}

                {/* Load more / loading indicator */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                  {ss.loading && <span style={{ fontSize: "0.78em", color: "#666" }}>Loading…</span>}
                  {!ss.loading && ss.hasMore && (
                    <Focusable
                      onActivate={() => loadReleasesPage(src.id, ss.page + 1)}
                      onClick={() => loadReleasesPage(src.id, ss.page + 1)}
                      focusClassName="is-focused"
                      style={{ ...BTN_STYLE, fontSize: "0.78em", padding: "3px 10px" }}
                    >
                      Load more
                    </Focusable>
                  )}
                  <Focusable
                    onActivate={() => loadReleasesPage(src.id, 1)}
                    onClick={() => loadReleasesPage(src.id, 1)}
                    focusClassName="is-focused"
                    style={{ ...BTN_STYLE, fontSize: "0.72em", padding: "2px 8px", marginLeft: "auto", opacity: ss.loading ? 0.5 : 1 }}
                  >
                    ↺ Refresh
                  </Focusable>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      {/* ── Feedback ────────────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Feedback</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Found a bug or have a feature request? Open an issue on GitHub.
      </p>
      <Focusable
        onActivate={() =>
          Navigation.NavigateToExternalWeb("https://github.com/avivkilloz/deckyfin/issues")
        }
        onClick={() =>
          Navigation.NavigateToExternalWeb("https://github.com/avivkilloz/deckyfin/issues")
        }
        focusClassName="is-focused"
        style={{
          padding: "8px 16px",
          fontSize: "0.85em",
          cursor: "pointer",
          borderRadius: "4px",
          border: "1px solid #0078d4",
          background: "transparent",
          color: "#0078d4",
          display: "inline-block",
        }}
      >
        Open an Issue
      </Focusable>
    </Focusable>
  );
};
