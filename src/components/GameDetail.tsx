import { VFC } from "react";
import { callable } from "@decky/api";
import { GameConfig } from "../types";

const removeGame = callable<[name: string], { success: boolean }>(
  "remove_game"
);
const addSteamShortcut = callable<
  [exe_path: string, app_name: string, start_dir?: string, launch_options?: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("add_steam_shortcut");

interface Props {
  game: GameConfig;
  onBack: () => void;
}

export const GameDetail: VFC<Props> = ({ game, onBack }) => {
  const handleAddToSteam = async () => {
    try {
      const res = await addSteamShortcut(
        game.executable,
        game.name,
        game.start_dir,
        game.launch_options || ""
      );
      if (res.success) {
        alert(`✅ Added to Steam (App ID: ${res.unsigned_appid})`);
      } else {
        alert(`❌ ${res.error || "Failed to add to Steam"}`);
      }
    } catch (err: any) {
      alert(`❌ ${err?.message || "Error"}`);
    }
  };

  const handleRemove = async () => {
    try {
      await removeGame(game.name);
      onBack();
    } catch (err: any) {
      alert(`❌ ${err?.message || "Error removing game"}`);
    }
  };

  return (
    <div style={{ padding: "8px" }}>
      <button onClick={onBack} style={{ marginBottom: "12px" }}>
        ← Back
      </button>
      <h3>{game.name}</h3>
      <p>
        <b>Executable:</b> {game.executable}
      </p>
      <p>
        <b>Start Dir:</b> {game.start_dir || "—"}
      </p>
      {game.launch_options && (
        <p>
          <b>Launch Options:</b> {game.launch_options}
        </p>
      )}
      {game.proton_version && (
        <p>
          <b>Proton:</b> {game.proton_version}
        </p>
      )}
      <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
        <button onClick={handleAddToSteam}>Add to Steam</button>
        <button onClick={handleRemove} style={{ color: "red" }}>
          Remove
        </button>
      </div>
    </div>
  );
};
