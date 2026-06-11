import { VFC, useState, useEffect, useRef, useCallback } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { CompactTextField } from "../components/CompactTextField";

const setGamesFolder = callable<
  [path: string],
  { success: boolean; path?: string; error?: string }
>("set_games_folder");
const initialize = callable<
  [games_folder?: string],
  { success: boolean; error?: string; message?: string }
>("initialize");
const getSteamGridKey = callable<[], { key: string; has_override: boolean }>(
  "get_steamgrid_key"
);
const setSteamGridKey = callable<
  [key: string],
  { success: boolean }
>("set_steamgrid_key");
const listSubfolders = callable<[path: string], string[]>("list_subfolders");

const getProtontricksStatus = callable<
  [],
  { flatpak_available: boolean; flatpak_installed: boolean; native_available: boolean; status: string }
>("get_protontricks_status");
const installProtontricks = callable<
  [],
  { success: boolean; message: string }
>("install_protontricks");

interface Props {
  gamesFolder: string | null;
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

export const SettingsPage: VFC<Props> = ({ gamesFolder, onBack }) => {
  const backRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus Back button on mount so B-button works immediately ──
  useEffect(() => {
    const timer = setTimeout(() => backRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  const [folderPath, setFolderPath] = useState(gamesFolder || "");
  const [message, setMessage] = useState<string | null>(null);
  const [rescanned, setRescanned] = useState(false);

  // ── Folder browser ───────────────────────────────────────────────────────
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [browsePath, setBrowsePath] = useState("/");
  const [subfolders, setSubfolders] = useState<string[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const loadSubfolders = useCallback(async (path: string) => {
    setBrowseLoading(true);
    try {
      const dirs = await listSubfolders(path);
      setSubfolders(dirs);
      setBrowsePath(path);
    } catch {
      setSubfolders([]);
    }
    setBrowseLoading(false);
  }, []);

  const handleOpenFolderPicker = async () => {
    if (showFolderPicker) {
      setShowFolderPicker(false);
      return;
    }
    await loadSubfolders("/");
    setShowFolderPicker(true);
  };

  const handleFolderClick = async (name: string) => {
    const newPath = browsePath === "/" ? `/${name}` : `${browsePath}/${name}`;
    await loadSubfolders(newPath);
  };

  const handleGoUp = async () => {
    if (browsePath === "/") return;
    const parent = browsePath.substring(0, browsePath.lastIndexOf("/"));
    const newPath = parent || "/";
    await loadSubfolders(newPath);
  };

  const handleSelectFolder = () => {
    setFolderPath(browsePath);
    setShowFolderPicker(false);
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

  const handleSave = async () => {
    setMessage(null);
    setRescanned(false);
    try {
      const result = await setGamesFolder(folderPath);
      if (result.success) {
        setMessage("✅ Settings saved!");
        await initialize(folderPath);
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage(`❌ ${result.error || "Save failed"}`);
      }
    } catch (err: any) {
      setMessage(`❌ ${err?.message || "Save failed"}`);
    }
  };

  const handleRescan = async () => {
    setMessage(null);
    setRescanned(false);
    try {
      const result = await initialize();
      if (result.success) {
        setMessage(`✅ ${result.message || "Scan complete"}`);
        setRescanned(true);
      } else {
        setMessage(`❌ ${result.error || "Scan failed"}`);
      }
    } catch (err: any) {
      setMessage(`❌ ${err?.message || "Scan failed"}`);
    }
  };

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

      {/* ── Games Folder ────────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Games Folder</h4>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "8px" }}>
        Path to the root directory containing your game folders. Each
        subdirectory is treated as a separate game with its own config.
      </p>
      <div
        style={{
          display: "flex",
          gap: "6px",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={handleOpenFolderPicker}
          onClick={handleOpenFolderPicker}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px" }}
        >
          {showFolderPicker ? "✕" : "Browse"}
        </Focusable>
      </div>

      {/* Folder browser dropdown */}
      {showFolderPicker && (
        <Focusable
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            padding: "2px 0",
          }}
        >
          <div style={{ fontSize: "0.85em", color: "#aaa", padding: "4px 10px 2px", wordBreak: "break-all" }}>
            {browsePath}
          </div>
          {browseLoading && (
            <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
              Loading…
            </p>
          )}
          {!browseLoading && (
            <div style={{ maxHeight: "180px", overflowY: "auto" }}>
              {browsePath !== "/" && (
                <Focusable
                  onActivate={handleGoUp}
                  onClick={handleGoUp}
                  focusClassName="is-focused"
                  style={{
                    margin: "0 2px",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontSize: "0.85em",
                    borderBottom: "1px solid #333",
                    color: "#f0ad4e",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  .. (up)
                </Focusable>
              )}
              {subfolders.length === 0 && browsePath === "/" && (
                <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
                  No subdirectories found
                </p>
              )}
              {subfolders.map((name) => (
                <Focusable
                  key={name}
                  onActivate={() => handleFolderClick(name)}
                  onClick={() => handleFolderClick(name)}
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
                  📁 {name}
                </Focusable>
              ))}
              <Focusable
                onActivate={handleSelectFolder}
                onClick={handleSelectFolder}
                focusClassName="is-focused"
                style={{
                  margin: "0 2px",
                  padding: "8px 10px",
                  cursor: "pointer",
                  fontSize: "0.85em",
                  color: "#27ae60",
                  textAlign: "center",
                  fontWeight: "bold",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                ✓ Select This Folder
              </Focusable>
            </div>
          )}
        </Focusable>
      )}

      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <Focusable
          onActivate={handleSave}
          onClick={handleSave}
          focusClassName="is-focused"
          style={BTN_STYLE}
        >
          Save
        </Focusable>
        {message && (
          <span style={{ fontSize: "0.85em", color: message.startsWith("✅") ? "#2ecc71" : "tomato" }}>
            {message}
          </span>
        )}
      </div>

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
        style={{ ...BTN_STYLE, marginBottom: "8px" }}
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
            <div style={{ marginBottom: "4px" }}>
              <span>✅</span>{" "}
              <span style={{ color: "#e0e0e0" }}>Flatpak protontricks</span>
            </div>
          )}
          {ptStatus.native_available && (
            <div>
              <span>✅</span>{" "}
              <span style={{ color: "#e0e0e0" }}>Native protontricks</span>
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

      {/* ── Maintenance ──────────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Maintenance</h4>

      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Re-discover games from the configured folder and create config entries for any new subdirectories.
      </p>
      <Focusable
        onActivate={handleRescan}
        onClick={handleRescan}
        focusClassName="is-focused"
        style={{
          padding: "8px 16px",
          fontSize: "0.85em",
          cursor: "pointer",
          borderRadius: "4px",
          border: "1px solid #f0ad4e",
          background: "transparent",
          color: "#f0ad4e",
          display: "inline-block",
        }}
      >
        Rescan Games Folder
      </Focusable>

      {message && <p style={{ marginTop: "12px", color: rescanned ? "#f0ad4e" : undefined }}>{message}</p>}

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
