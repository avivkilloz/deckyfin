import { VFC, useState, useEffect } from 'react';
import { ServerAPI } from 'decky-frontend-lib';
import { GameConfig, GameFolder } from '../types';

interface Props {
  serverAPI: ServerAPI;
  folders: GameFolder[];
  onDone: () => void;
  onBack: () => void;
}

export const AddGameWizard: VFC<Props> = ({ serverAPI, folders, onDone, onBack }) => {
  const [step, setStep] = useState<'folder' | 'exe' | 'configure' | 'confirm'>('folder');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [exes, setExes] = useState<string[]>([]);
  const [selectedExe, setSelectedExe] = useState<string>('');
  const [config, setConfig] = useState<Partial<GameConfig>>({
    name: '',
    proton_version: '',
    proton_dependencies: [],
    categories: [],
    launch_options: '',
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selectFolder = async (folderPath: string) => {
    setSelectedFolder(folderPath);
    const folderInfo = folders.find((f) => f.path === folderPath);
    const name = folderInfo?.name || folderPath;
    setConfig((c) => ({ ...c, name }));

    // Scan for exes
    const res = await serverAPI.callPluginMethod<{ subfolder: string }, string[]>(
      'scan_game_exes', { subfolder: folderPath }
    );
    if (res.success && res.result.length > 0) {
      setExes(res.result);
      setSelectedExe(res.result[0]);
      setStep('configure');
    } else {
      setExes([]);
      setStep('configure');
    }
  };

  const addDependency = (dep: string) => {
    if (!config.proton_dependencies?.includes(dep)) {
      setConfig((c) => ({
        ...c,
        proton_dependencies: [...(c.proton_dependencies || []), dep],
      }));
    }
  };

  const removeDep = (dep: string) => {
    setConfig((c) => ({
      ...c,
      proton_dependencies: (c.proton_dependencies || []).filter((d) => d !== dep),
    }));
  };

  const saveGame = async () => {
    setSaving(true);
    setResult(null);

    const gameConfig: GameConfig = {
      name: config.name || selectedFolder || 'Unknown',
      path: selectedFolder || undefined,
      executable: `${selectedFolder}/${selectedExe}`,
      proton_version: config.proton_version || undefined,
      proton_dependencies: config.proton_dependencies,
      categories: config.categories,
      launch_options: config.launch_options,
    };

    const res = await serverAPI.callPluginMethod<{ config: GameConfig }, any>(
      'add_game', { config: gameConfig }
    );
    if (res.success) {
      setResult('✅ Game added!');
      setTimeout(() => onDone(), 1500);
    } else {
      setResult(`❌ ${(res.result as any)?.error || 'Failed to add game'}`);
    }
    setSaving(false);
  };

  // Step 1: Select folder
  if (step === 'folder') {
    return (
      <div style={{ padding: '8px' }}>
        <button onClick={onBack} style={{ marginBottom: '12px' }}>← Cancel</button>
        <h3 style={{ margin: '0 0 12px 0' }}>Select Game Folder</h3>
        {folders.length === 0 && <p>No game folders detected.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {folders.map((f) => (
            <button
              key={f.path}
              onClick={() => selectFolder(f.path)}
              style={{ textAlign: 'left', padding: '10px' }}
            >
              📁 {f.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2: Configure
  return (
    <div style={{ padding: '8px' }}>
      <button onClick={() => setStep('folder')} style={{ marginBottom: '12px' }}>← Back</button>
      <h3 style={{ margin: '0 0 12px 0' }}>Configure: {config.name}</h3>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Executable</label>
        <select
          value={selectedExe}
          onChange={(e) => setSelectedExe(e.target.value)}
          style={{ width: '100%', padding: '6px' }}
        >
          {exes.map((exe) => (
            <option key={exe} value={exe}>{exe}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Game Name</label>
        <input
          type="text"
          value={config.name}
          onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Proton Version</label>
        <input
          type="text"
          value={config.proton_version || ''}
          onChange={(e) => setConfig((c) => ({ ...c, proton_version: e.target.value }))}
          placeholder="e.g. GE-Proton10-25"
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Launch Options</label>
        <input
          type="text"
          value={config.launch_options || ''}
          onChange={(e) => setConfig((c) => ({ ...c, launch_options: e.target.value }))}
          placeholder="e.g. DXVK_HUD=1 %command%"
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Dependencies</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {(config.proton_dependencies || []).map((dep) => (
            <span key={dep} style={{
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(102,126,234,0.3)',
              cursor: 'pointer',
              fontSize: '12px',
            }} onClick={() => removeDep(dep)}>
              {dep} ✕
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {['vcrun2022', 'vcrun2019', 'd3dx9', 'd3dx11', 'dotnet48', 'xact', 'physx'].map((dep) => (
            <button key={dep} onClick={() => addDependency(dep)} style={{ fontSize: '11px', padding: '2px 6px' }}>
              +{dep}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px' }}>Categories</label>
        <input
          type="text"
          value={(config.categories || []).join(', ')}
          onChange={(e) => setConfig((c) => ({
            ...c,
            categories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
          }))}
          placeholder="RPG, Action, Simulation"
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
        />
      </div>

      <button onClick={saveGame} disabled={saving} style={{ width: '100%' }}>
        {saving ? 'Saving...' : 'Save Game Config'}
      </button>
      {result && <p style={{ marginTop: '8px' }}>{result}</p>}
    </div>
  );
};
