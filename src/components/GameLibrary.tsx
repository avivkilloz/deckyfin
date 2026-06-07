import { VFC, useState, useEffect, useCallback } from "react";
import { callable } from "@decky/api";
import { GameConfig } from "../types";
import { GameCard } from "../components/GameCard";
import { SettingsPage } from "../components/SettingsPage";
import { GameDetail } from "../components/GameDetail";

const getGames = callable<[], GameConfig[]>("get_games");
const getGamesFolder = callable<[], string | null>("get_games_folder");
const listNonSteamGames = callable<[], { name: string }[]>("list_nonsteam_games");
const restartSteam = callable<[], { success: boolean; message?: string }>("restart_steam");

export const GameLibrary: VFC = () => {
  const [games, setGames] = useState<GameConfig[]>([]);
  const [gamesFolder, setGamesFolder] = useState<string | null>(null);
  const [steamNames, setSteamNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<
    "library" | "settings" | "game-detail"
  >("library");
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [restarting, setRestarting] = useState(false);

  const handleRestartSteam = useCallback(async () => {
    setRestarting(true);
    try {
      await restartSteam();
    } catch (_) {
      // Steam will close this UI as part of the restart — errors here are expected
    }
    setRestarting(false);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gamesRes, infoRes] = await Promise.all([
        getGames(),
        getGamesFolder(),
      ]);
      setGames(gamesRes || []);
      setGamesFolder(infoRes ?? null);
    } catch (err: any) {
      setError(String(err));
    }
    // Load Steam shortcuts separately — failure here shouldn't block the library
    try {
      const steamGames = await listNonSteamGames();
      setSteamNames(new Set((steamGames || []).map((g) => g.name)));
    } catch (_) {
      setSteamNames(new Set());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openGame = (game: GameConfig) => {
    setSelectedGame(game);
    setView("game-detail");
  };

  const filteredGames = games.filter((g) =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (view === "settings") {
    return <SettingsPage gamesFolder={gamesFolder} onBack={() => { loadData(); setView("library"); }} />;
  }

  if (view === "game-detail" && selectedGame) {
    return (
      <GameDetail
        game={selectedGame}
        onBack={() => {
          loadData();
          setView("library");
        }}
      />
    );
  }

  return (
    <div style={{ padding: "8px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <h2 style={{ margin: 0 }}>🎮 Deckyfin</h2>
        <div style={{ display: "flex", gap: "6px" }}>
          <button onClick={handleRestartSteam} disabled={restarting} title="Restart Steam">
            {restarting ? "…" : "↺"}
          </button>
          <button onClick={() => setView("settings")}>⚙</button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search games..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{
          width: "100%",
          padding: "8px",
          marginBottom: "12px",
          boxSizing: "border-box",
        }}
      />

      {/* Game list */}
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && !gamesFolder && (
        <div>
          <p>No games folder configured!</p>
          <button onClick={() => setView("settings")}>Configure</button>
        </div>
      )}
      {!loading && filteredGames.length === 0 && gamesFolder && (
        <p>No games found. Add game folders to your games directory, then go to Settings > Rescan.</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "8px",
        }}
      >
        {filteredGames.map((game) => (
          <GameCard key={game.name} game={game} isInSteam={steamNames.has(game.name)} onClick={() => openGame(game)} />
        ))}
      </div>
    </div>
  );
};
