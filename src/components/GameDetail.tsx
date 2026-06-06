import { VFC, useState, useEffect, useCallback } from "react";
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
const scanExes = callable<[subfolder: string], string[]>("scan_game_exes");

interface Props {
  game: GameConfig;
  onBack: () => void;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: "2px",
  fontSize: "0.85em",
  color: "#aaa",
};

const FIELD_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "6px",
  marginBottom: "10px",
  boxSizing: "border-box",
};

const BTN_STYLE: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "0.85em",
  cursor: "pointer",
  borderRadius: "4px",
  border: "1px solid #555",
  background: "transparent",
  color: "#e0e0e0",
};

export const GameDetail: VFC<Props> = ({ game, onBack }) => {
  // ── Editable config fields ──────────────────────────────────────────────
  const [name, setName] = useState(game.name);
  const [executable, setExecutable] = useState(game.executable);
  const [startDir, setStartDir] = useState(game.start_dir || "");
  const [protonVersion, setProtonVersion] = useState(
    game.proton_version || ""
  );
  const [dependencies, setDependencies] = useState(
    (game.proton_dependencies || []).join(", ")
  );

  // ── Steam integration ───────────────────────────────────────────────────
  const [steamInfo, setSteamInfo] = useState<{
    app_id: number;
    unsigned_appid: number;
  } | null>(null);
  const [currentProton, setCurrentProton] = useState<string | null>(null);

  // ── Loading states ──────────────────────────────────────────────────────
  const [loading, setLoading] = useState<string | null>(null); // which action is running
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [forceReinit, setForceReinit] = useState(false);

  // ── Executable picker ───────────────────────────────────────────────────
  const [showExePicker, setShowExePicker] = useState(false);
  const [exeOptions, setExeOptions] = useState<string[]>([]);

  // ── Proton versions ─────────────────────────────────────────────────────
  const [protonVersions, setProtonVersions] = useState<string[]>([]);

  // ── Init on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    listProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]));
  }, []);

  useEffect(() => {
    getSteamShortcut(game.name)
      .then((res) => {
        if (res.success && res.app_id && res.unsigned_appid) {
          setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        }
      })
      .catch(() => {});
  }, [game.name]);

  // ── Auto-save helpers ──────────────────────────────────────────────────
  const saveConfig = useCallback(
    (updates: Record<string, any>) => {
      updateGameConfig(name, updates).catch(() => {});
    },
    [name]
  );

  const handleSaveName = (val: string) => {
    saveConfig({ name: val });
  };
  const handleSaveExecutable = (val: string) => {
    saveConfig({ executable: val });
  };
  const handleSaveStartDir = (val: string) => {
    saveConfig({ start_dir: val });
  };
  const handleSaveProton = (val: string) => {
    setProtonVersion(val);
    saveConfig({ proton_version: val || null });
  };
  const handleSaveDeps = (val: string) => {
    const arr = val
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    saveConfig({ proton_dependencies: arr });
  };

  // ── Executable picker ───────────────────────────────────────────────────
  const handleOpenExePicker = async () => {
    if (showExePicker) {
      setShowExePicker(false);
      return;
    }
    try {
      const exes = await scanExes(startDir || game.name);
      setExeOptions(exes);
      setShowExePicker(true);
    } catch {
      setFeedback({ ok: false, msg: "Failed to scan executables" });
    }
  };

  const handleSelectExe = (exe: string) => {
    const full = `${startDir}/${exe}`;
    setExecutable(full);
    setShowExePicker(false);
    handleSaveExecutable(full);
  };

  // ── Action handlers ─────────────────────────────────────────────────────
  const handleAddToSteam = async () => {
    setLoading("add");
    setFeedback(null);
    try {
      const res = await addSteamShortcut(
        executable,
        name,
        startDir || undefined,
        game.launch_options || ""
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setFeedback({
          ok: true,
          msg: `Added to Steam (App ID: ${res.unsigned_appid}) — restart Steam to see it`,
        });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to add to Steam" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleRemoveSteam = async () => {
    setLoading("remove");
    setFeedback(null);
    try {
      const res = await removeSteamShortcut(name);
      if (res.success) {
        setSteamInfo(null);
        setFeedback({ ok: true, msg: "Removed from Steam — restart Steam to apply" });
      } else {
        setFeedback({ ok: false, msg: res.error || "Not found in Steam shortcuts" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleSetProton = async () => {
    if (!steamInfo || !protonVersion) return;
    setLoading("proton");
    setFeedback(null);
    try {
      const res = await setGameProton(steamInfo.app_id, protonVersion);
      if (res.success) {
        setCurrentProton(protonVersion);
        setFeedback({ ok: true, msg: `Proton set to ${protonVersion} — restart Steam to apply` });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to set Proton" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleInitPrefix = async () => {
    if (!steamInfo) return;
    setLoading("init");
    setFeedback(null);
    try {
      const res = await initPrefix(
        steamInfo.app_id,
        protonVersion || undefined,
        forceReinit
      );
      if (res.success) {
        setFeedback({ ok: true, msg: "Prefix initialized" });
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to init prefix" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleInstallDeps = async () => {
    if (!steamInfo || !dependencies.trim()) return;
    setLoading("deps");
    setFeedback(null);
    try {
      const res = await installDeps(
        String(steamInfo.unsigned_appid),
        dependencies
      );
      if (res.success) {
        const installed = (res.installed || []).join(", ");
        setFeedback({ ok: true, msg: `Installed: ${installed}` });
      } else {
        const failed = (res.failed || []).join(", ");
        setFeedback({
          ok: false,
          msg: `Failed: ${failed || res.error || "Installation failed"}`,
        });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleRemove = async () => {
    setFeedback(null);
    try {
      await removeGame(name);
      onBack();
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error removing game" });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "8px" }}>
      {/* Back + Remove */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <button onClick={onBack}>← Back</button>
        <button onClick={handleRemove} style={{ color: "tomato" }}>
          ✕ Remove
        </button>
      </div>

      {/* ── Config Fields ──────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Game Settings</h4>

      {/* Name */}
      <label style={LABEL_STYLE}>Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => handleSaveName(e.target.value)}
        style={FIELD_STYLE}
      />

      {/* Executable */}
      <label style={LABEL_STYLE}>Executable</label>
      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: showExePicker ? "4px" : "10px",
        }}
      >
        <input
          value={executable}
          onChange={(e) => setExecutable(e.target.value)}
          onBlur={(e) => handleSaveExecutable(e.target.value)}
          style={{ flex: 1, padding: "6px", boxSizing: "border-box" }}
        />
        <button onClick={handleOpenExePicker} style={BTN_STYLE}>
          {showExePicker ? "✕" : "Browse"}
        </button>
      </div>

      {/* Executable picker dropdown */}
      {showExePicker && (
        <div
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "180px",
            overflowY: "auto",
          }}
        >
          {exeOptions.length === 0 && (
            <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
              No executables found in {startDir}
            </p>
          )}
          {exeOptions.map((exe) => (
            <div
              key={exe}
              onClick={() => handleSelectExe(exe)}
              style={{
                padding: "8px 10px",
                cursor: "pointer",
                fontSize: "0.85em",
                borderBottom: "1px solid #333",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {exe}
            </div>
          ))}
        </div>
      )}

      {/* Start Dir */}
      <label style={LABEL_STYLE}>Start Dir</label>
      <input
        value={startDir}
        onChange={(e) => setStartDir(e.target.value)}
        onBlur={(e) => handleSaveStartDir(e.target.value)}
        style={FIELD_STYLE}
      />

      {/* Proton Version */}
      <label style={LABEL_STYLE}>Proton Version</label>
      <select
        value={protonVersion}
        onChange={(e) => handleSaveProton(e.target.value)}
        style={FIELD_STYLE}
      >
        <option value="">— None —</option>
        {protonVersions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>

      {/* Dependencies */}
      <label style={LABEL_STYLE}>
        Dependencies
        <span style={{ color: "#666", fontWeight: "normal" }}>
          {" "}
          (comma-separated, e.g. vcrun2022,d3dx9)
        </span>
      </label>
      <input
        value={dependencies}
        onChange={(e) => setDependencies(e.target.value)}
        onBlur={(e) => handleSaveDeps(e.target.value)}
        style={FIELD_STYLE}
      />

      {/* ── Separator ──────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "14px 0" }} />

      {/* ── Steam Status ────────────────────────────────────────────────── */}
      <div
        style={{
          fontSize: "0.85em",
          color: "#aaa",
          marginBottom: "12px",
        }}
      >
        {steamInfo ? (
          <>✅ In Steam (App {steamInfo.unsigned_appid})</>
        ) : (
          <>Not in Steam</>
        )}
        {currentProton && <> · Proton: {currentProton}</>}
      </div>

      {/* ── Action Buttons ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        <button
          onClick={handleAddToSteam}
          disabled={loading === "add" || !!steamInfo}
          style={{ ...BTN_STYLE, opacity: loading === "add" || !!steamInfo ? 0.5 : 1 }}
        >
          {loading === "add" ? "Adding…" : "Add to Steam"}
        </button>

        <button
          onClick={handleRemoveSteam}
          disabled={loading === "remove" || !steamInfo}
          style={{ ...BTN_STYLE, opacity: loading === "remove" || !steamInfo ? 0.5 : 1 }}
        >
          {loading === "remove" ? "Removing…" : "Remove from Steam"}
        </button>

        <button
          onClick={handleSetProton}
          disabled={!steamInfo || !protonVersion || loading === "proton"}
          style={{ ...BTN_STYLE, opacity: !steamInfo || !protonVersion || loading === "proton" ? 0.5 : 1 }}
        >
          {loading === "proton" ? "Setting…" : "Set Proton"}
        </button>

        <button
          onClick={handleInitPrefix}
          disabled={!steamInfo || loading === "init"}
          style={{ ...BTN_STYLE, opacity: !steamInfo || loading === "init" ? 0.5 : 1 }}
        >
          {loading === "init" ? "Initing…" : forceReinit ? "Re-init Prefix" : "Init Prefix"}
        </button>

        <button
          onClick={() => setForceReinit(!forceReinit)}
          style={{
            ...BTN_STYLE,
            background: forceReinit ? "#ff6666" : "transparent",
            borderColor: forceReinit ? "#ff6666" : "#555",
            color: forceReinit ? "white" : "#aaa",
          }}
        >
          {forceReinit ? "✓ Force re-init" : "☐ Force re-init"}
        </button>

        <button
          onClick={handleInstallDeps}
          disabled={!steamInfo || !dependencies.trim() || loading === "deps"}
          style={{ ...BTN_STYLE, opacity: !steamInfo || !dependencies.trim() || loading === "deps" ? 0.5 : 1 }}
        >
          {loading === "deps" ? "Installing…" : "Install Deps"}
        </button>
      </div>

      {/* ── Feedback ───────────────────────────────────────────────────── */}
      {feedback && (
        <p
          style={{
            marginTop: "12px",
            color: feedback.ok ? "lightgreen" : "tomato",
            fontSize: "0.9em",
          }}
        >
          {feedback.msg}
        </p>
      )}
    </div>
  );
};
