import { VFC } from 'react';
import { GameConfig } from '../types';

interface Props {
  game: GameConfig;
  onClick: () => void;
}

export const GameCard: VFC<Props> = ({ game, onClick }) => {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px',
        borderRadius: '8px',
        cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.1)',
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Placeholder icon */}
      <div style={{
        width: '100%',
        height: '100px',
        background: 'linear-gradient(135deg, #667eea, #764ba2)',
        borderRadius: '4px',
        marginBottom: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
      }}>
        🎮
      </div>

      <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>{game.name}</h3>

      {game.categories && game.categories.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '4px' }}>
          {game.categories.map((cat) => (
            <span key={cat} style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(102,126,234,0.3)',
            }}>
              {cat}
            </span>
          ))}
        </div>
      )}

      {game.proton_version && (
        <p style={{ margin: 0, fontSize: '11px', color: '#aaa' }}>
          Proton: {game.proton_version}
        </p>
      )}
    </div>
  );
};
