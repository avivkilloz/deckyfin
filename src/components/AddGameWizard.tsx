import { VFC, useState, useEffect } from "react";
import { callable } from "@decky/api";
import { GameConfig, GameFolder } from "../types";

const scanExes = callable<[subfolder: string], string[]>("scan_game_exes");
const addGame = callable<[config: GameConfig], any>("add_game");
const listProtonVersions = callable<[], string[]>("list_proton_versions");

interface Props {
  folders: GameFolder[];
  onDone: () => void;
  onBack: () => void;
}

export const AddGameWizard: VFC<Props> = ({ folders, onDone, onBack }) => {
  const [step, setStep] = useState(0);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [exeList, setExeList] = useState<string[]>([]);
  const [selectedExe, setSelectedExe] = useState<string>("");
  const [gameName, setGameName] = useState("");
  const [protonVersion, setProtonVersion] = useState("");
  const [protonDeps, setProtonDeps] = useState("");
  const [protonVersions, setProtonVersions] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFolder) {
      scanExes(selectedFolder).then(setExeList).catch(() => setExeList([]));
    }
  }, [selectedFolder]);

  useEffect(() => {
    listProtonVersions().then(setProtonVersions).catch(() => setProtonVersions([]));
  }, []);

  const handleAdd = async () => {
    const config: GameConfig = {
      name: gameName,
      executable: `${selectedFolder}/${selectedExe}`,
      start_dir: selectedFolder,
    };
    if (protonVersion) config.proton_version = protonVersion;
    if (protonDeps.trim()) {
      config.proton_dependencies = protonDeps
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
    }
    setResult(`Adding ${gameName}...`);
    try {
      const res = await addGame(config);
      setResult(`✅ Added "${gameName}" successfully!`);
    } catch (err: any) {
      setResult(`❌ ${err?.message || "Failed to add game"}`);
    }
  };

  const backStep = () => {
    if (step > 0) setStep(step - 1);
    else onBack();
  };

  return (
    <div style={{ padding: "8px" }}>
      <button onClick={backStep} style={{ marginBottom: "12px" }}>
        ← {step === 0 ? "Cancel" : "Back"}
      </button>
      <h3>Add Game to Deckyfin</h3>

      {result ? (
        <div>
          <p>{result}</p>
          <button onClick={onDone}>Done</button>
        </div>
      ) : step === 0 ? (
        <div>
          <p>Select a game folder:</p>
          {folders.map((f) => (
            <div key={f.path}>
              <button
                onClick={() => {
                  setSelectedFolder(f.name);
                  setGameName(f.name);
                  setStep(1);
                }}
              >
                {f.name}
              </button>
            </div>
          ))}
          {folders.length === 0 && <p>No folders detected.</p>}
        </div>
      ) : step === 1 ? (
        <div>
          <p>
            Select executable in <b>{selectedFolder}</b>:
          </p>
          {exeList.map((exe) => (
            <div key={exe}>
              <button
                onClick={() => {
                  setSelectedExe(exe);
                  setStep(2);
                }}
                style={selectedExe === exe ? { fontWeight: "bold" } : {}}
              >
                {exe}
              </button>
            </div>
          ))}
          {exeList.length === 0 && <p>No .exe files found.</p>}
        </div>
      ) : (
        <div>
          <p style={{ fontSize: "0.85em", color: "#aaa", marginTop: 0 }}>
            Configure Proton settings for this game. You can change these
            later from the game detail page.
          </p>

          <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
            Game name:
          </label>
          <input
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            style={{ width: "100%", padding: "6px", marginBottom: "10px", boxSizing: "border-box" }}
          />

          <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
            Proton version:
          </label>
          <select
            value={protonVersion}
            onChange={(e) => setProtonVersion(e.target.value)}
            style={{ width: "100%", padding: "6px", marginBottom: "10px", boxSizing: "border-box" }}
          >
            <option value="">— None (default) —</option>
            {protonVersions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <label style={{ display: "block", marginBottom: "4px", fontSize: "0.9em" }}>
            Dependencies (comma-separated protontricks packages):
          </label>
          <input
            value={protonDeps}
            onChange={(e) => setProtonDeps(e.target.value)}
            placeholder="vcrun2022, d3dx9, xact"
            style={{ width: "100%", padding: "6px", marginBottom: "12px", boxSizing: "border-box" }}
          />

          <button
            onClick={handleAdd}
            disabled={!gameName.trim()}
            style={{ width: "100%", padding: "10px" }}
          >
            Add to Deckyfin
          </button>
        </div>
      )}
    </div>
  );
};
