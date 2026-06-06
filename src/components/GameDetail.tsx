import { VFC } from 'react';
import { ServerAPI } from 'decky-frontend-lib';
import { GameConfig } from '../types';

interface Props {
  serverAPI: ServerAPI;
  game: GameConfig;
  onBack: () => void;
}

export const GameDetail: VFC<Props> = ({ serverAPI, game, onBack }) => {
  return (
    <div style={{ padding: '8px' }}>
      <button onClick={onBack} style={{ marginBottom: '12px' }}>← Back</button>

      <h2 style={{ margin: '0 0 8px 0' }}>{game.name}</h2>

      <div style={{ marginBottom: '16px' }}>
        <p><strong>Executable:</strong> {game.executable}</p>
        <p><strong>Path:</strong> {game.path || '-'}</p>
        <p><strong>Proton:</strong> {game.proton_version || 'Not set'}</p>
        <p><strong>Launch Options:</strong> {game.launch_options || '-'}</p>
      </div>

      {/* Dependencies */}
      {game.proton_dependencies && game.proton_dependencies.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Proton Dependencies</h3>
          <ul style={{ margin: 0, paddingLeft: '16px' }}>
            {game.proton_dependencies.map((dep) => (
              <li key={dep}>{dep}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Categories */}
      {game.categories && game.categories.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Categories</h3>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {game.categories.map((cat) => (
              <span key={cat} style={{
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(102,126,234,0.3)',
                fontSize: '12px',
              }}>
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Save Sync */}
      {game.proton_sync_paths && game.proton_sync_paths.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Save Sync Paths</h3>
          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px' }}>
            {game.proton_sync_paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button>⚙ Setup Game</button>
        <button>🔧 Init Prefix</button>
        <button>📦 Install Deps</button>
      </div>
    </div>
  );
};
