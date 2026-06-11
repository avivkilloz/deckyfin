import { VFC, useState, useEffect, useRef, useCallback } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { Source } from "../types";
import { CompactTextField } from "../components/CompactTextField";

const listSources = callable<[], Source[]>("list_sources");
const addSource = callable<
  [name: string, type: string, path: string | null, url: string | null],
  { success: boolean; source?: Source; error?: string }
>("add_source");
const removeSource = callable<[source_id: string], { success: boolean }>("remove_source");
const getSourceDiskUsage = callable<[source_id: string], { used: number | null; total: number | null; free: number | null }>("get_source_disk_usage");
const initializeSource = callable<[source_id: string], { success: boolean; message?: string }>("initialize_source");

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

  // ── Sources state ─────────────────────────────────────────────────────────
  const [sources, setSources] = useState<Source[]>([]);
  const [diskUsages, setDiskUsages] = useState<Record<string, { used: number | null; total: number | null; free: number | null }>>({});
  const [sourceMessage, setSourceMessage] = useState<{ id: string; msg: string } | null>(null);

  // Add source form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<"local" | "mount" | "agent">("local");
  const [newSourcePath, setNewSourcePath] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [addSourceMsg, setAddSourceMsg] = useState<string | null>(null);

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
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            {(["local", "mount", "agent"] as const).map((t) => (
              <Focusable key={t} onActivate={() => setNewSourceType(t)} onClick={() => setNewSourceType(t)} focusClassName="is-focused"
                style={{ padding: "3px 10px", fontSize: "0.82em", borderRadius: "12px", cursor: "pointer",
                  border: newSourceType === t ? "1px solid #0078d4" : "1px solid #555",
                  background: newSourceType === t ? "#0078d4" : "transparent",
                  color: newSourceType === t ? "white" : "#ccc" }}>
                {t}
              </Focusable>
            ))}
          </div>
          {newSourceType !== "agent" ? (
            <>
              <div style={{ fontSize: "0.78em", color: "#888", marginBottom: "4px" }}>Path</div>
              <CompactTextField value={newSourcePath} onChange={(e) => setNewSourcePath(e.target.value)} placeholder="/home/deck/Games" style={{ width: "100%", marginBottom: "8px" }} />
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
              <div>
                <span style={{ fontWeight: 600, color: "#e0e0e0" }}>{src.name}</span>
                <span style={{ marginLeft: "8px", padding: "2px 7px", fontSize: "0.75em", borderRadius: "10px", background: typeBg, color: typeColor, border: `1px solid ${typeColor}` }}>{src.type}</span>
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
