import { VFC } from 'react';
import { GameConfig } from '../types';

interface Props {
  game: GameConfig;
  isInSteam?: boolean;
  onClick: () => void;
}

export const GameCard: VFC<Props> = ({ game, isInSteam, onClick }) => {
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
      {/* Placeholder icon with Steam badge */}
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
        position: 'relative',
      }}>
        🎮
        {isInSteam && (
          <div title="Added to Steam" style={{
            position: 'absolute',
            bottom: '4px',
            right: '4px',
            background: '#1b2838',
            borderRadius: '50%',
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="#c7d5e0">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
            </svg>
          </div>
        )}
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
