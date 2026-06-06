import { VFC, useState } from 'react';
import { ServerAPI } from 'decky-frontend-lib';

interface Props {
  serverAPI: ServerAPI;
  gamesFolder: string | null;
  onBack: () => void;
}

export const SettingsPage: VFC<Props> = ({ serverAPI, gamesFolder, onBack }) => {
  const [folderPath, setFolderPath] = useState(gamesFolder || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveFolder = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await serverAPI.callPluginMethod<{ path: string }, any>(
        'set_games_folder', { path: folderPath }
      );
      if (result.success) {
        // Initialize after setting folder
        await serverAPI.callPluginMethod<{}, any>('initialize', {});
        setMessage('✅ Games folder saved & initialized!');
      } else {
        setMessage(`❌ ${result.result?.error || 'Save failed'}`);
      }
    } catch (err: any) {
      setMessage(`❌ ${String(err)}`);
    }
    setSaving(false);
  };

  return (
    <div style={{ padding: '8px' }}>
      <button onClick={onBack} style={{ marginBottom: '12px' }}>← Back to Library</button>
      <h2 style={{ margin: '0 0 16px 0' }}>⚙ Settings</h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Games Folder
        </label>
        <input
          type="text"
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="/home/deck/Games"
          style={{
            width: '100%',
            padding: '8px',
            boxSizing: 'border-box',
            marginBottom: '8px',
          }}
        />
        {gamesFolder && (
          <p style={{ fontSize: '12px', color: '#888' }}>Current: {gamesFolder}</p>
        )}
        <button onClick={saveFolder} disabled={saving || !folderPath}>
          {saving ? 'Saving...' : 'Save & Initialize'}
        </button>
        {message && <p style={{ marginTop: '8px', fontSize: '13px' }}>{message}</p>}
      </div>
    </div>
  );
};
