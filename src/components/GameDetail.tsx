import { VFC, useState, useEffect } from "react";
import { callable } from "@decky/api";
import { GameConfig } from "../types";

const removeGame = callable<[name: string], { success: boolean }>(
  "remove_game"
);
const addSteamShortcut = callable<
  [exe_path: string, app_name: string, start_dir?: string, launch_options?: string],
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
  [name: string, updates: Record<string, any>],
  { success: boolean }
>("update_game_config");

interface Props {
  game: GameConfig;
  onBack: () => void;
}

export const GameDetail: VFC<Props> = ({ game, onBack }) => {
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [addingToSteam, setAddingToSteam] = useState(false);
  const [steamInfo, setSteamInfo] = useState<{ app_id: number; unsigned_appid: number } | null>(null);

  // Proton panel state
  const [protonVersions, setProtonVersions] = useState<string[]>([]);
  const [selectedProton, setSelectedProton] = useState("");
  const [protonFeedback, setProtonFeedback] = useState<string | null>(null);
  const [currentProton, setCurrentProton] = useState<string | null>(null);
  const [initLoading, setInitLoading] = useState(false);
  const [initFeedback, setInitFeedback] = useState<string | null>(null);
  const [forceReinit, setForceReinit] = useState(false);
  const [depsInput, setDepsInput] = useState(
    (game.proton_dependencies || []).join(", ")
  );
  const [depsLoading, setDepsLoading] = useState(false);
  const [depsFeedback, setDepsFeedback] = useState<string | null>(null);

  // Load proton versions on mount
  useEffect(() => {
    listProtonVersions().then(setProtonVersions).catch(() => setProtonVersions([]));
  }, []);

  // Check if game is already a Steam shortcut on mount
  useEffect(() => {
    getSteamShortcut(game.name).then((res) => {
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
      }
    }).catch(() => {});
  }, [game.name]);

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
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
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
        setSteamInfo(null);
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

  const handleSetProton = async () => {
    if (!steamInfo || !selectedProton) return;
    setProtonFeedback(`Setting Proton to ${selectedProton}...`);
    try {
      const res = await setGameProton(steamInfo.app_id, selectedProton);
      if (res.success) {
        setCurrentProton(selectedProton);
        setProtonFeedback(`✅ Proton set to ${selectedProton}`);
        // Persist to Deckyfin config
        await updateGameConfig(game.name, { proton_version: selectedProton });
      } else {
        setProtonFeedback(`❌ ${res.error || "Failed to set Proton"}`);
      }
    } catch (err: any) {
      setProtonFeedback(`❌ ${err?.message || "Error"}`);
    }
  };

  const handleInitPrefix = async () => {
    if (!steamInfo) return;
    setInitLoading(true);
    setInitFeedback("Initializing prefix (may take a minute)...");
    try {
      const res = await initPrefix(steamInfo.app_id, selectedProton || undefined, forceReinit);
      if (res.success) {
        setInitFeedback("✅ Prefix initialized!");
      } else {
        setInitFeedback(`❌ ${res.error || "Failed to init prefix"}`);
      }
    } catch (err: any) {
      setInitFeedback(`❌ ${err?.message || "Error"}`);
    }
    setInitLoading(false);
  };

  const handleInstallDeps = async () => {
    if (!steamInfo || !depsInput.trim()) return;
    setDepsLoading(true);
    setDepsFeedback(`Installing ${depsInput}... (may take a while)`);
    try {
      const res = await installDeps(String(steamInfo.unsigned_appid), depsInput);
      if (res.success) {
        setDepsFeedback(`✅ Installed: ${(res.installed || []).join(", ")}`);
        // Persist deps to Deckyfin config
        const deps = depsInput.split(",").map((d) => d.trim()).filter(Boolean);
        await updateGameConfig(game.name, { proton_dependencies: deps });
      } else {
        const failed = (res.failed || []).join(", ");
        setDepsFeedback(`❌ Failed: ${failed || res.error || "Installation failed"}`);
      }
    } catch (err: any) {
      setDepsFeedback(`❌ ${err?.message || "Error"}`);
    }
    setDepsLoading(false);
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
          <b>Proton (config):</b> {game.proton_version}
        </p>
      )}
      {game.proton_dependencies && game.proton_dependencies.length > 0 && (
        <p>
          <b>Dependencies:</b> {game.proton_dependencies.join(", ")}
        </p>
      )}

      {/* Steam actions */}
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

      {/* Proton management panel — only shown after game is in Steam */}
      {steamInfo && (
        <div style={{ marginTop: "20px", borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "16px" }}>
          <h4 style={{ margin: "0 0 12px 0" }}>🔧 Proton Configuration</h4>

          {/* Proton version selector */}
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
              Version:
            </label>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <select
                value={selectedProton}
                onChange={(e) => setSelectedProton(e.target.value)}
                style={{ flex: 1, padding: "6px", boxSizing: "border-box" }}
              >
                <option value="">— Select Proton —</option>
                {protonVersions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button onClick={handleSetProton} disabled={!selectedProton}>
                Set
              </button>
            </div>
            {currentProton && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85em", color: "#aaa" }}>
                Current: {currentProton}
              </p>
            )}
            {protonFeedback && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85em", color: protonFeedback.startsWith("✅") ? "lightgreen" : "tomato" }}>
                {protonFeedback}
              </p>
            )}
          </div>

          {/* Init prefix */}
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
              Proton Prefix:
            </label>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button onClick={handleInitPrefix} disabled={initLoading}>
                {initLoading ? "Initializing…" : "Init Prefix"}
              </button>
              <button
                  onClick={() => setForceReinit(!forceReinit)}
                  style={{
                    fontSize: "0.85em",
                    padding: "4px 8px",
                    background: forceReinit ? "#ff6666" : "transparent",
                    border: "1px solid",
                    borderColor: forceReinit ? "#ff6666" : "#555",
                    color: forceReinit ? "white" : "#aaa",
                    cursor: "pointer",
                    borderRadius: "4px",
                    minWidth: "120px",
                  }}
                >
                  {forceReinit ? "✓ Force re-init" : "☐ Force re-init"}
                </button>
            </div>
            {initFeedback && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85em", color: initFeedback.startsWith("✅") ? "lightgreen" : "tomato" }}>
                {initFeedback}
              </p>
            )}
          </div>

          {/* Dependencies */}
          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
              Install Dependencies (comma-separated, e.g. vcrun2022,d3dx9):
            </label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                value={depsInput}
                onChange={(e) => setDepsInput(e.target.value)}
                placeholder="vcrun2022,d3dx9,xact"
                style={{ flex: 1, padding: "6px", boxSizing: "border-box" }}
              />
              <button onClick={handleInstallDeps} disabled={depsLoading || !depsInput.trim()}>
                {depsLoading ? "Installing…" : "Install"}
              </button>
            </div>
            {depsFeedback && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.85em", color: depsFeedback.startsWith("✅") ? "lightgreen" : "tomato" }}>
                {depsFeedback}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
