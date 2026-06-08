import { VFC, useState, useEffect, useRef } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable, TextField } from "@decky/ui";

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
  const folderRef = useRef<HTMLInputElement>(null);
  const sgKeyRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus root on mount so B-button works immediately ──
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const [folderPath, setFolderPath] = useState(gamesFolder || "");
  const [message, setMessage] = useState<string | null>(null);
  const [rescanned, setRescanned] = useState(false);

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

  const handleSave = async () => {
    setMessage(null);
    setRescanned(false);
    try {
      const result = await setGamesFolder(folderPath);
      if (result.success) {
        setMessage("✅ Settings saved!");
        await initialize(folderPath);
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
      ref={rootRef}
      onCancel={onBack}
      onCancelButton={onBack}
      focusClassName="is-focused"
      style={{ padding: "8px" }}
    >
      <Focusable
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
        ← Back
      </Focusable>
      <h3>Settings</h3>

      {/* ── Games Folder ────────────────────────────────────────────────── */}
      <label>Games Folder:</label>
      <Focusable onActivate={() => folderRef.current?.focus()} focusClassName="is-focused" style={{ marginBottom: "12px" }}>
        <input
          ref={folderRef}
          type="text"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="/home/deck/games"
          style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
        />
      </Focusable>

      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <Focusable
          onActivate={handleSave}
          onClick={handleSave}
          focusClassName="is-focused"
          style={BTN_STYLE}
        >
          Save
        </Focusable>
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
      <Focusable onActivate={() => sgKeyRef.current?.focus()} focusClassName="is-focused" style={{ marginBottom: "8px" }}>
        <input
          ref={sgKeyRef}
          type="text"
          value={sgKey}
          onChange={(e) => setSgKey(e.target.value)}
          placeholder="Enter your API key or leave empty for default"
          style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
        />
      </Focusable>

      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <Focusable
          onActivate={handleSaveKey}
          onClick={handleSaveKey}
          focusClassName="is-focused"
          style={BTN_STYLE}
        >
          Save Key
        </Focusable>
        {sgHasOverride && (
          <span style={{ fontSize: "0.8em", color: "#f0ad4e" }}>
            (custom key active)
          </span>
        )}
      </div>

      {sgMessage && (
        <p style={{ marginTop: "8px", fontSize: "0.9em", color: sgMessage.startsWith("✅") ? "lightgreen" : "tomato" }}>
          {sgMessage}
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
    </Focusable>
  );
};
