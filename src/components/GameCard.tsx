import { VFC, useState, useEffect } from "react";
import { callable } from "@decky/api";
import { Focusable } from "@decky/ui";
import { GameConfig } from "../types";

const getGameCardArt = callable<
  [game_name: string],
  { data_uri: string | null }
>("get_game_card_art");

interface Props {
  game: GameConfig;
  isInSteam?: boolean;
  sourceCount?: number;
  onClick: () => void;
}

export const GameCard: VFC<Props> = ({ game, isInSteam, sourceCount, onClick }) => {
  const [artUri, setArtUri] = useState<string | null>(null);

  useEffect(() => {
    getGameCardArt(game.name)
      .then((res) => setArtUri(res.data_uri || null))
      .catch(() => setArtUri(null));
  }, [game.name]);

  return (
    <Focusable
      onActivate={onClick}
      onClick={onClick}
      focusClassName="is-focused"
      style={{
        padding: "12px",
        borderRadius: "8px",
        cursor: "pointer",
        border: "1px solid rgba(255,255,255,0.1)",
        transition: "background 0.2s",
      }}
      onFocus={(e) => (e.currentTarget.style.boxShadow = "0 0 0 3px #51cbf8, 0 0 12px rgba(81,203,248,0.4)")}
      onBlur={(e) => (e.currentTarget.style.boxShadow = "none")}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Art image or gradient placeholder */}
      <div
        style={{
          width: "100%",
          height: "100px",
          borderRadius: "4px",
          marginBottom: "8px",
          position: "relative",
          overflow: "hidden",
          background: artUri
            ? `center / cover no-repeat url("${artUri}")`
            : "linear-gradient(135deg, #667eea, #764ba2)",
        }}
      >
        {!artUri && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: "100%",
              fontSize: "32px",
            }}
          >
            🎮
          </div>
        )}
      </div>

      <h3 style={{ margin: "0 0 4px 0", fontSize: "14px" }}>{game.name}</h3>

      {game.categories && game.categories.length > 0 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "4px" }}>
          {game.categories.map((cat) => (
            <span key={cat} style={{
              fontSize: "10px",
              padding: "2px 6px",
              borderRadius: "4px",
              background: "rgba(102,126,234,0.3)",
            }}>
              {cat}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
        {sourceCount !== undefined && sourceCount > 1 && (
          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(0,120,212,0.25)", color: "#74b9ff" }}>
            {sourceCount} sources
          </span>
        )}
        {isInSteam && (
          <div
            title="Added to Steam"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="#c7d5e0">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/>
            </svg>
            <span style={{ fontSize: "10px", color: "#c7d5e0" }}>Steam</span>
          </div>
        )}
      </div>
    </Focusable>
  );
};
