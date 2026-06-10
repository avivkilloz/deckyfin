import { VFC, useState, useEffect, useRef } from "react";
import { callable } from "@decky/api";
import { Navigation, Focusable } from "@decky/ui";
import { GameConfig } from "../types";
import { useArtwork } from "../hooks/useArtwork";
import { CompactTextField } from "../components/CompactTextField";

const removeGame = callable<[name: string], { success: boolean }>(
  "remove_game"
);
const addSteamShortcut = callable<
  [exe_path: string, app_name: string, start_dir?: string, launch_options?: string, proton_version?: string],
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
const purgeSteamGameData = callable<
  [app_name: string],
  { success: boolean; removed_shortcut?: boolean; removed_prefix?: boolean; removed_grid?: boolean; unsigned_appid?: number; errors?: string[] }
>("purge_steam_game_data");
const updateSteamShortcut = callable<
  [app_name: string, exe_path: string, start_dir?: string, launch_options?: string, proton_version?: string],
  { success: boolean; app_id?: number; unsigned_appid?: number; error?: string }
>("update_steam_shortcut");
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
const setGameProcessingState = callable<
  [name: string, state: Record<string, any> | null],
  { success: boolean }
>("set_game_processing_state");
const getGameProcessingState = callable<
  [name: string],
  Record<string, any> | null
>("get_game_processing_state");

/** Popular Proton dependencies shown as toggle chips. */
const POPULAR_DEPS = [
  "vcrun2022",
  "vcrun2019",
  "vcrun2013",
  "vcrun2010",
  "vcrun2008",
  "d3dx9",
  "d3dx10",
  "d3dx11",
  "d3dcompiler_47",
  "dotnet48",
  "dotnet40",
  "dotnet35sp1",
  "dotnet20",
  "physx",
  "mfplat",
  "xna",
  "dwrite",
  "corefonts",
];

interface Props {
  game: GameConfig;
  onBack: () => void;
  onNeedsRestart?: () => void;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: "2px",
  fontSize: "0.85em",
  color: "#aaa",
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

export const GameDetail: VFC<Props> = ({ game, onBack, onNeedsRestart }) => {
  // ── Refs ─────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  // ── Auto-focus Back button on mount so B-button works immediately ──
  useEffect(() => {
    const timer = setTimeout(() => backRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // ── Editable config fields ──────────────────────────────────────────────
  const [name, setName] = useState(game.name);
  const [storedName, setStoredName] = useState(game.name); // last saved name (lookup key)
  const [executable, setExecutable] = useState(game.executable);
  const [startDir, setStartDir] = useState(game.start_dir || "");
  const [steamAppId, setSteamAppId] = useState<number | undefined>(
    game.steam_app_id
  );
  const [steamAppIdInput, setSteamAppIdInput] = useState(
    game.steam_app_id !== undefined ? String(game.steam_app_id) : ""
  );

  const [protonVersion, setProtonVersion] = useState(
    game.proton_version || ""
  );
  const [protonPickerOpen, setShowProtonPicker] = useState(false);

  const [launchOptions, setLaunchOptions] = useState(
    game.launch_options || ""
  );

  // ── Dependencies: checkboxes + custom ────────────────────────────────────
  const existingDeps = game.proton_dependencies || [];
  const [checkedDeps, setCheckedDeps] = useState<string[]>(
    existingDeps.filter((d) => POPULAR_DEPS.includes(d))
  );
  const [customDeps, setCustomDeps] = useState<string>(
    existingDeps
      .filter((d) => !POPULAR_DEPS.includes(d))
      .join(", ")
  );

  const mergedDeps = ((): string[] => {
    const custom = customDeps
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const all = [...checkedDeps, ...custom];
    // Deduplicate preserving order (first seen wins)
    const seen = new Set<string>();
    return all.filter((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
  })();

  const toggleCheckedDep = (id: string) => {
    setCheckedDeps((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

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

  // ── Confirmation state (inline, CEF confirm() is blocked) ──────────────
  const [confirming, setConfirming] = useState<"steam" | "deckyfin" | "purge" | null>(null);
  const [needsRestartAfterAdd, setNeedsRestartAfterAdd] = useState(
    game.needs_restart_after_add ?? false
  );

  // ── Executable picker ───────────────────────────────────────────────────
  const [showExePicker, setShowExePicker] = useState(false);
  const [exeOptions, setExeOptions] = useState<string[]>([]);
  const [scanRoot, setScanRoot] = useState(""); // subfolder scanned for exes

  // ── Proton versions ─────────────────────────────────────────────────────
  const [protonVersions, setProtonVersions] = useState<string[]>([]);

  // ── Artwork ───────────────────────────────────────────────────────────────
  const { applyAllArt } = useArtwork();

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

  // ── Restore processing state on mount (e.g. Installing… survived navigation) ──
  useEffect(() => {
    getGameProcessingState(game.name)
      .then((state: any) => {
        if (state?.status === "installing") {
          setLoading("deps");
          setFeedback({ ok: false, msg: "Installing dependencies — this can take a few minutes" });
        }
      })
      .catch(() => {});
  }, [game.name]);

  // ── Auto-save (none — use "Apply Config" button) ─────────────────────

  const handleApplyConfig = async () => {
    try {
      const res = await updateGameConfig(storedName, {
        name,
        executable,
        start_dir: startDir || null,
        steam_app_id: steamAppId ?? null,
        proton_version: protonVersion || null,
        proton_dependencies: mergedDeps,
        launch_options: launchOptions || null,
      });
      if (!res.success) {
        setFeedback({ ok: false, msg: "Failed to save config" });
      } else {
        setStoredName(name);
        setFeedback({ ok: true, msg: "Config saved" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Failed to save config" });
    }
  };

  // ── Executable picker ───────────────────────────────────────────────────
  const handleOpenExePicker = async () => {
    if (showExePicker) {
      setShowExePicker(false);
      return;
    }
    const root = game.path || game.name;
    try {
      const exes = await scanExes(root);
      setExeOptions(exes);
      setScanRoot(root);
      setShowExePicker(true);
    } catch {
      setFeedback({ ok: false, msg: "Failed to scan executables" });
    }
  };

  const handleSelectExe = (exe: string) => {
    const full = scanRoot ? `${scanRoot}/${exe}` : exe;
    setExecutable(full);
    const lastSlash = full.lastIndexOf("/");
    const dir = lastSlash > 0 ? full.substring(0, lastSlash) : full;
    setStartDir(dir);
    setShowExePicker(false);
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
        launchOptions || "",
        protonVersion || undefined
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setNeedsRestartAfterAdd(true);
        setFeedback({
          ok: true,
          msg: `Added to Steam (App ID: ${res.unsigned_appid}) — restart Steam to unlock actions`,
        });
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to add to Steam" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleUpdateSteam = async () => {
    setLoading("update");
    setFeedback(null);
    try {
      const res = await updateSteamShortcut(
        name,
        executable,
        startDir || undefined,
        launchOptions || "",
        protonVersion || undefined
      );
      if (res.success && res.app_id && res.unsigned_appid) {
        setSteamInfo({ app_id: res.app_id, unsigned_appid: res.unsigned_appid });
        setFeedback({
          ok: true,
          msg: "Steam updated — restart Steam to apply",
        });
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Failed to update Steam shortcut" });
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
        onNeedsRestart?.();
      } else {
        setFeedback({ ok: false, msg: res.error || "Not found in Steam shortcuts" });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handlePurgeSteam = async () => {
    setLoading("purge");
    setFeedback(null);
    try {
      const res = await purgeSteamGameData(name);
      if (res.success) {
        setSteamInfo(null);
        setFeedback({ ok: true, msg: "All Steam data purged — restart Steam to apply" });
        onNeedsRestart?.();
      } else {
        const detail = res.errors?.length ? res.errors.join("; ") : "Not found";
        setFeedback({ ok: false, msg: `Purge failed: ${detail}` });
      }
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleInitPrefix = async () => {
    if (needsRestartAfterAdd || !steamInfo) return;
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
    if (needsRestartAfterAdd || !steamInfo || mergedDeps.length === 0 || loading === "deps") return;
    setLoading("deps");
    setFeedback({ ok: false, msg: "Installing dependencies — this can take a few minutes" });
    // Persist processing state so it survives navigation away
    setGameProcessingState(game.name, {
      status: "installing",
      deps: mergedDeps,
      pfxid: String(steamInfo.unsigned_appid),
    }).catch(() => {});
    try {
      const res = await installDeps(
        String(steamInfo.unsigned_appid),
        mergedDeps.join(", ")
      );
      // Clear processing state on completion
      setGameProcessingState(game.name, null).catch(() => {});
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
      setGameProcessingState(game.name, null).catch(() => {});
      setFeedback({ ok: false, msg: err?.message || "Error" });
    }
    setLoading(null);
  };

  const handleAddArt = async () => {
    if (needsRestartAfterAdd || !steamInfo) return;
    setLoading("art");
    setFeedback(null);
    try {
      const { applied, errors } = await applyAllArt(
        name,
        steamInfo.unsigned_appid
      );
      if (applied.length > 0) {
        setFeedback({
          ok: true,
          msg: `Applied ${applied.join(", ")} art`,
        });
      } else {
        setFeedback({
          ok: false,
          msg: errors.join("; ") || "No art found",
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
      await removeGame(storedName);
      onBack();
    } catch (err: any) {
      setFeedback({ ok: false, msg: err?.message || "Error removing game" });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Focusable
      ref={rootRef}
      onCancel={onBack}
      onCancelButton={onBack}
      focusClassName="is-focused"
      style={{ padding: "8px" }}
    >
      {/* Back */}
      <Focusable
        ref={backRef}
        onActivate={onBack}
        onClick={onBack}
        focusClassName="is-focused"
        style={{ ...BTN_STYLE, marginBottom: "12px", display: "inline-block" }}
      >
        Back
      </Focusable>

      {/* ── Config Fields ──────────────────────────────────────────────── */}
      <h4 style={{ margin: "0 0 10px 0" }}>Game Settings</h4>

      {/* Name */}
      <label style={LABEL_STYLE}>Name</label>
      <CompactTextField
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Executable */}
      <label style={LABEL_STYLE}>Executable</label>
      <div
        style={{
          display: "flex",
          gap: "6px",
          marginBottom: showExePicker ? "4px" : "10px",
          alignItems: "center",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={handleOpenExePicker}
          onClick={handleOpenExePicker}
          focusClassName="is-focused"
          style={{ ...BTN_STYLE, alignSelf: "center", padding: "4px 12px" }}
        >
          {showExePicker ? "✕" : "Browse"}
        </Focusable>
      </div>

      {/* Executable picker dropdown */}
      {showExePicker && (
        <Focusable
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "180px",
            overflowY: "auto",
            padding: "2px 0",
          }}
        >
          {exeOptions.length === 0 && (
            <p style={{ padding: "8px", margin: 0, fontSize: "0.85em", color: "#888" }}>
              No executables found in {startDir}
            </p>
          )}
          {exeOptions.map((exe) => (
            <Focusable
              key={exe}
              onActivate={() => handleSelectExe(exe)}
              onClick={() => handleSelectExe(exe)}
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
              {exe}
            </Focusable>
          ))}
        </Focusable>
      )}

      {/* Start Dir */}
      <label style={LABEL_STYLE}>Start Dir</label>
      <CompactTextField
        value={startDir}
        onChange={(e) => setStartDir(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Steam App ID */}
      <label style={LABEL_STYLE}>Steam App ID</label>
      <CompactTextField
        value={steamAppIdInput}
        onChange={(e) => {
          setSteamAppIdInput(e.target.value);
          const parsed = parseInt(e.target.value, 10);
          setSteamAppId(isNaN(parsed) ? undefined : parsed);
        }}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Launch Options */}
      <label style={LABEL_STYLE}>Launch Options</label>
      <CompactTextField
        value={launchOptions}
        onChange={(e) => setLaunchOptions(e.target.value)}
        style={{ width: "100%", marginBottom: "10px" }}
      />

      {/* Proton Version: inline picker */}
      <label style={LABEL_STYLE}>Proton Version</label>
      <Focusable
        onActivate={() => setShowProtonPicker((p) => !p)}
        onClick={() => setShowProtonPicker((p) => !p)}
        focusClassName="is-focused"
        style={{
          ...BTN_STYLE,
          display: "inline-block",
          padding: "4px 12px",
          marginBottom: protonPickerOpen ? "4px" : "10px",
          background: protonVersion ? "transparent" : "transparent",
          color: protonVersion ? "#e0e0e0" : "#888",
        }}
      >
        {protonVersion || "— None —"}
      </Focusable>
      {protonPickerOpen && (
        <div
          style={{
            marginBottom: "10px",
            border: "1px solid #555",
            borderRadius: "4px",
            maxHeight: "200px",
            overflowY: "auto",
            padding: "2px 0",
          }}
        >
          <Focusable
            onActivate={() => { setProtonVersion(""); setShowProtonPicker(false); }}
            onClick={() => { setProtonVersion(""); setShowProtonPicker(false); }}
            focusClassName="is-focused"
            style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: !protonVersion ? "#0078d4" : "#ccc" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            — None —
          </Focusable>
          {protonVersions.map((v) => (
            <Focusable
              key={v}
              onActivate={() => { setProtonVersion(v); setShowProtonPicker(false); }}
              onClick={() => { setProtonVersion(v); setShowProtonPicker(false); }}
              focusClassName="is-focused"
              style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: protonVersion === v ? "#0078d4" : "#ccc" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {v}
            </Focusable>
          ))}
        </div>
      )}

      {/* ── Dependencies: Toggle Chips + Custom ──────────────────────── */}
      <label style={LABEL_STYLE}>
        Dependencies
        <span style={{ color: "#666", fontWeight: "normal" }}>
          {" "}
          (click to select)
        </span>
      </label>

      <div
        style={{
          marginBottom: "8px",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "10px",
          }}
        >
          {POPULAR_DEPS.map((dep) => {
            const selected = checkedDeps.includes(dep);
            return (
              <Focusable
                key={dep}
                onActivate={() => toggleCheckedDep(dep)}
                onClick={() => toggleCheckedDep(dep)}
                focusClassName="is-focused"
                style={{
                  padding: "4px 12px",
                  fontSize: "0.82em",
                  border: selected
                    ? "1px solid #0078d4"
                    : "1px solid #555",
                  borderRadius: "14px",
                  background: selected ? "#0078d4" : "transparent",
                  color: selected ? "white" : "#ccc",
                  cursor: "pointer",
                }}
              >
                {dep}
              </Focusable>
            );
          })}
        </div>

        {/* Custom dependencies */}
        <label style={{ fontSize: "0.82em", color: "#888", display: "block", marginBottom: "2px" }}>
          Custom (comma-separated)
        </label>
        <CompactTextField
          value={customDeps}
          onChange={(e) => setCustomDeps(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      {/* ── SteamDB lookup ──────────────────────────────────────────────── */}
      <div style={{ fontSize: "0.82em", color: "#888", marginBottom: "8px" }}>
        Look up dependencies on{" "}
        <Focusable
          onActivate={() =>
            Navigation.NavigateToExternalWeb(
              steamAppId
                ? `https://steamdb.info/app/${steamAppId}/`
                : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`
            )
          }
          onClick={() =>
            Navigation.NavigateToExternalWeb(
              steamAppId
                ? `https://steamdb.info/app/${steamAppId}/`
                : `https://steamdb.info/search/?a=all&q=${encodeURIComponent(name.replace(/\s*\(.*?\)\s*$/, "").trim())}`
            )
          }
          focusClassName="is-focused"
          style={{ color: "#0078d4", textDecoration: "underline", cursor: "pointer", display: "inline" }}
        >
          SteamDB
        </Focusable>
        {" — "}under Depots → Redistributables
        {steamAppId && (
          <span style={{ color: "#666" }}> (App {steamAppId})</span>
        )}
      </div>

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

      {/* ── Restart required warning ─────────────────────────────────────── */}
      {needsRestartAfterAdd && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "10px",
            borderRadius: "4px",
            background: "rgba(230, 126, 34, 0.15)",
            border: "1px solid rgba(230, 126, 34, 0.3)",
            fontSize: "0.82em",
            color: "#e67e22",
          }}
        >
          ⚠ Restart Steam to unlock Init Prefix, Install Dependencies, and Add Art
        </div>
      )}

      {/* ── Action Buttons ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        <Focusable
          onActivate={handleApplyConfig}
          onClick={handleApplyConfig}
          focusClassName="is-focused"
          style={BTN_STYLE}
        >
          Apply Config
        </Focusable>

        <Focusable
          onActivate={steamInfo ? handleUpdateSteam : handleAddToSteam}
          onClick={steamInfo ? handleUpdateSteam : handleAddToSteam}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: loading === "add" || loading === "update" ? 0.5 : 1,
          }}
        >
          {loading === "add"
            ? "Adding…"
            : loading === "update"
            ? "Updating…"
            : steamInfo
            ? "Update Steam"
            : "Add to Steam"}
        </Focusable>

        <Focusable
          onActivate={handleInitPrefix}
          onClick={handleInitPrefix}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !steamInfo || needsRestartAfterAdd || loading === "init" ? 0.5 : 1,
          }}
        >
          {loading === "init" ? "Initing…" : forceReinit ? "Re-init Prefix" : "Init Prefix"}
        </Focusable>

        <Focusable
          onActivate={() => setForceReinit(!forceReinit)}
          onClick={() => setForceReinit(!forceReinit)}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            background: forceReinit ? "#ff6666" : "transparent",
            borderColor: forceReinit ? "#ff6666" : "#555",
            color: needsRestartAfterAdd ? "#555" : forceReinit ? "white" : "#aaa",
            opacity: needsRestartAfterAdd ? 0.4 : 1,
          }}
        >
          {forceReinit ? "✓ Force re-init" : "☐ Force re-init"}
        </Focusable>

        <Focusable
          onActivate={handleInstallDeps}
          onClick={handleInstallDeps}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !steamInfo || needsRestartAfterAdd || mergedDeps.length === 0 || loading === "deps" ? 0.5 : 1,
          }}
        >
          {loading === "deps" ? "Installing…" : "Install Dependencies"}
        </Focusable>

        <Focusable
          onActivate={handleAddArt}
          onClick={handleAddArt}
          focusClassName="is-focused"
          style={{
            ...BTN_STYLE,
            opacity: !steamInfo || needsRestartAfterAdd || loading === "art" ? 0.5 : 1,
          }}
        >
          {loading === "art" ? "Adding Art…" : "Add Art"}
        </Focusable>
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

      {/* ── Danger Zone ──────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "24px 0 8px" }} />
      <div style={{ fontSize: "0.8em", color: "#e74c3c", marginBottom: "8px", fontWeight: "bold" }}>
        ⚠ Danger Zone
      </div>

      {steamInfo && (
        <div>
          {confirming === "steam" ? (
            <div
              style={{
                border: "1px solid #c0392b",
                borderRadius: "4px",
                padding: "10px",
                marginBottom: "8px",
                textAlign: "center",
                fontSize: "0.85em",
                color: "#e74c3c",
              }}
            >
              <div style={{ marginBottom: "6px" }}>Remove from Steam?</div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <Focusable
                  onActivate={() => { setConfirming(null); handleRemoveSteam(); }}
                  onClick={() => { setConfirming(null); handleRemoveSteam(); }}
                  focusClassName="is-focused"
                  style={{
                    ...BTN_STYLE,
                    border: "1px solid #c0392b",
                    background: "#c0392b",
                    color: "white",
                  }}
                >
                  Yes, Remove
                </Focusable>
                <Focusable
                  onActivate={() => setConfirming(null)}
                  onClick={() => setConfirming(null)}
                  focusClassName="is-focused"
                  style={BTN_STYLE}
                >
                  Cancel
                </Focusable>
              </div>
            </div>
          ) : (
            <Focusable
              onActivate={() => setConfirming("steam")}
              onClick={() => setConfirming("steam")}
              focusClassName="is-focused"
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "0.85em",
                cursor: "pointer",
                borderRadius: "4px",
                border: "1px solid #c0392b",
                background: "transparent",
                color: "#e74c3c",
                marginBottom: "8px",
                textAlign: "center",
                opacity: loading === "remove" ? 0.5 : 1,
              }}
            >
              {loading === "remove" ? "Removing…" : "Remove from Steam"}
            </Focusable>
          )}
        </div>
      )}

      {/* ── Purge All Steam Data ────────────────────────────────────────── */}
      {steamInfo && (
        <div>
          {confirming === "purge" ? (
            <div
              style={{
                border: "1px solid #9b59b6",
                borderRadius: "4px",
                padding: "10px",
                marginBottom: "8px",
                textAlign: "center",
                fontSize: "0.85em",
                color: "#9b59b6",
              }}
            >
              <div style={{ marginBottom: "6px" }}>
                Purge all Steam data for this game? This removes the shortcut,
                prefix, config, and grid art. Cannot be undone.
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                <Focusable
                  onActivate={() => { setConfirming(null); handlePurgeSteam(); }}
                  onClick={() => { setConfirming(null); handlePurgeSteam(); }}
                  focusClassName="is-focused"
                  style={{
                    ...BTN_STYLE,
                    border: "1px solid #9b59b6",
                    background: "#9b59b6",
                    color: "white",
                  }}
                >
                  Yes, Purge Everything
                </Focusable>
                <Focusable
                  onActivate={() => setConfirming(null)}
                  onClick={() => setConfirming(null)}
                  focusClassName="is-focused"
                  style={BTN_STYLE}
                >
                  Cancel
                </Focusable>
              </div>
            </div>
          ) : (
            <Focusable
              onActivate={() => setConfirming("purge")}
              onClick={() => setConfirming("purge")}
              focusClassName="is-focused"
              style={{
                width: "100%",
                padding: "10px 0",
                fontSize: "0.85em",
                cursor: "pointer",
                borderRadius: "4px",
                border: "1px solid #9b59b6",
                background: "transparent",
                color: "#9b59b6",
                marginBottom: "8px",
                textAlign: "center",
                opacity: loading === "purge" ? 0.5 : 1,
              }}
            >
              {loading === "purge" ? "Purging…" : "Purge All Steam Data"}
            </Focusable>
          )}
        </div>
      )}

      {confirming === "deckyfin" ? (
        <div
          style={{
            border: "1px solid #c0392b",
            borderRadius: "4px",
            padding: "12px",
            textAlign: "center",
            fontSize: "0.85em",
            color: "#e74c3c",
          }}
        >
          <div style={{ marginBottom: "6px" }}>Remove from Deckyfin? This cannot be undone.</div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
            <Focusable
              onActivate={() => { setConfirming(null); handleRemove(); }}
              onClick={() => { setConfirming(null); handleRemove(); }}
              focusClassName="is-focused"
              style={{
                ...BTN_STYLE,
                border: "1px solid #c0392b",
                background: "#c0392b",
                color: "white",
              }}
            >
              Yes, Remove
            </Focusable>
            <Focusable
              onActivate={() => setConfirming(null)}
              onClick={() => setConfirming(null)}
              focusClassName="is-focused"
              style={BTN_STYLE}
            >
              Cancel
            </Focusable>
          </div>
        </div>
      ) : (
        <Focusable
          onActivate={() => setConfirming("deckyfin")}
          onClick={() => setConfirming("deckyfin")}
          focusClassName="is-focused"
          style={{
            width: "100%",
            padding: "12px 0",
            fontSize: "0.85em",
            cursor: "pointer",
            borderRadius: "4px",
            border: "1px solid #c0392b",
            background: "transparent",
            color: "#e74c3c",
            textAlign: "center",
          }}
        >
          Remove from Deckyfin
        </Focusable>
      )}
    </Focusable>
  );
};
