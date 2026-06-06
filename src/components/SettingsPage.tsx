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

  const handleSave = async () => {
    setMessage(null);
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

      {message && <p style={{ marginTop: "12px" }}>{message}</p>}
    </div>
  );
};
