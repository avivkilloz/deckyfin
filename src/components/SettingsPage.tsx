import { VFC, useState } from "react";
import { callable } from "@decky/api";

const setGamesFolder = callable<
  [path: string],
  { success: boolean; path?: string; error?: string }
>("set_games_folder");
const initialize = callable<
  [games_folder?: string],
  { success: boolean; error?: string; message?: string }
>("initialize");

interface Props {
  gamesFolder: string | null;
  onBack: () => void;
}

export const SettingsPage: VFC<Props> = ({ gamesFolder, onBack }) => {
  const [folderPath, setFolderPath] = useState(gamesFolder || "");
  const [message, setMessage] = useState<string | null>(null);
  const [rescanned, setRescanned] = useState(false);

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
    <div style={{ padding: "8px" }}>
      <button onClick={onBack} style={{ marginBottom: "12px" }}>
        ← Back
      </button>
      <h3>Settings</h3>

      <label>Games Folder:</label>
      <input
        type="text"
        value={folderPath}
        onChange={(e) => setFolderPath(e.target.value)}
        placeholder="/home/deck/games"
        style={{ width: "100%", marginBottom: "12px", padding: "8px", boxSizing: "border-box" }}
      />

      <button onClick={handleSave}>Save</button>

      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "20px 0" }} />

      <h4 style={{ margin: "0 0 10px 0" }}>Maintenance</h4>

      <p style={{ fontSize: "0.85em", color: "#aaa", marginBottom: "10px" }}>
        Re-discover games from the configured folder and create config entries for any new subdirectories.
      </p>
      <button
        onClick={handleRescan}
        style={{
          padding: "8px 16px",
          fontSize: "0.85em",
          cursor: "pointer",
          borderRadius: "4px",
          border: "1px solid #f0ad4e",
          background: "transparent",
          color: "#f0ad4e",
        }}
      >
        Rescan Games Folder
      </button>

      {message && <p style={{ marginTop: "12px", color: rescanned ? "#f0ad4e" : undefined }}>{message}</p>}
    </div>
  );
};
