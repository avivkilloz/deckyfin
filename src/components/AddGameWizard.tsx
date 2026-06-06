import { VFC, useState, useEffect } from "react";
import { callable } from "@decky/api";
import { GameConfig, GameFolder } from "../types";

const scanExes = callable<[subfolder: string], string[]>("scan_game_exes");
const addGame = callable<[config: GameConfig], any>("add_game");

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
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFolder) {
      scanExes(selectedFolder).then(setExeList).catch(() => setExeList([]));
    }
  }, [selectedFolder]);

  const handleAdd = async () => {
    const config: GameConfig = {
      name: gameName,
      executable: `${selectedFolder}/${selectedExe}`,
      start_dir: selectedFolder,
    };
    setResult(`Adding ${gameName}...`);
    try {
      const res = await addGame(config);
      setResult(`✅ Added "${gameName}" successfully!`);
    } catch (err: any) {
      setResult(`❌ ${err?.message || "Failed to add game"}`);
    }
  };

  return (
    <div style={{ padding: "8px" }}>
      <button onClick={onBack} style={{ marginBottom: "12px" }}>
        ← Cancel
      </button>
      <h3>Add Game to Deckyfin</h3>
      <p style={{ fontSize: "0.85em", color: "#aaa", marginTop: 0 }}>
        This saves the game to your Deckyfin config. Use "Add to Steam" from the game detail page to add a Steam shortcut.
      </p>

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
              <button onClick={() => { setSelectedFolder(f.name); setGameName(f.name); setStep(1); }}>{f.name}</button>
            </div>
          ))}
          {folders.length === 0 && <p>No folders detected.</p>}
        </div>
      ) : step === 1 ? (
        <div>
          <p>Select executable in <b>{selectedFolder}</b>:</p>
          {exeList.map((exe) => (
            <div key={exe}>
              <button
                onClick={() => { setSelectedExe(exe); setStep(2); }}
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
          <label>Game name:</label>
          <input value={gameName} onChange={(e) => setGameName(e.target.value)} />
          <label>Proton version (optional):</label>
          <input value={protonVersion} onChange={(e) => setProtonVersion(e.target.value)} />
          <br />
          <button onClick={handleAdd}>Add to Deckyfin</button>
        </div>
      )}
    </div>
  );
};
