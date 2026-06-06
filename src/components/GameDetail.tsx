import { VFC, useState } from "react";
import { callable } from "@decky/api";
import { GameConfig } from "../types";

const removeGame = callable<[name: string], { success: boolean }>(
  "remove_game"
);
const addSteamShortcut = callable<
  [exe_path: string, app_name: string, start_dir?: string, launch_options?: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("add_steam_shortcut");
const removeSteamShortcut = callable<
  [app_name: string],
  { success: boolean; error?: string }
>("remove_steam_shortcut");

interface Props {
  game: GameConfig;
  onBack: () => void;
}

export const GameDetail: VFC<Props> = ({ game, onBack }) => {
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addingToSteam, setAddingToSteam] = useState(false);

  const handleAddToSteam = async () => {
    setAddingToSteam(true);
    setFeedback(null);
    try {
      const res = await addSteamShortcut(
        game.executable,
        game.name,
        game.start_dir,
        game.launch_options || ""
      );
      if (res.success) {
        setFeedback({ ok: true, msg: `Added to Steam — restart Steam to see it (App ID: ${res.unsigned_appid})` });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to add to Steam" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setAddingToSteam(false);
  };

  const handleRemoveSteam = async () => {
    setFeedback(null);
    try {
      const res = await removeSteamShortcut(game.name);
      if (res.success) {
        setFeedback({ ok: true, msg: "Removed from Steam — restart Steam to apply" });
      } else {
        setFeedback({ ok: false, msg: res.error || "Not found in Steam shortcuts" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
  };

  const handleRemove = async () => {
    setFeedback(null);
    try {
      await removeGame(game.name);
      onBack();
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error removing game" });
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
      <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={handleAddToSteam} disabled={addingToSteam}>
          {addingToSteam ? "Adding…" : "Add to Steam"}
        </button>
        <button onClick={handleRemoveSteam}>Remove from Steam</button>
        <button onClick={handleRemove} style={{ color: "red" }}>
          Remove from Deckyfin
        </button>
      </div>
      {feedback && (
        <p style={{ marginTop: "10px", color: feedback.ok ? "lightgreen" : "tomato" }}>
          {feedback.ok ? "✅" : "❌"} {feedback.msg}
        </p>
      )}
    </div>
  );
};
