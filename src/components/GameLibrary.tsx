import { VFC, useState, useEffect, useCallback } from "react";
import { callable } from "@decky/api";
import { GameConfig, GameFolder } from "../types";
import { GameCard } from "../components/GameCard";
import { SettingsPage } from "../components/SettingsPage";
import { AddGameWizard } from "../components/AddGameWizard";
import { GameDetail } from "../components/GameDetail";

const getGames = callable<[], GameConfig[]>("get_games");
const scanFolders = callable<[], GameFolder[]>("scan_games_folder");
const getGamesFolder = callable<[], string | null>(
  "get_games_folder"
);

export const GameLibrary: VFC = () => {
  const [games, setGames] = useState<GameConfig[]>([]);
  const [folders, setFolders] = useState<GameFolder[]>([]);
  const [gamesFolder, setGamesFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<
    "library" | "settings" | "add-game" | "game-detail"
  >("library");
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gamesRes, folderRes, infoRes] = await Promise.all([
        getGames(),
        scanFolders(),
        getGamesFolder(),
      ]);
      setGames(gamesRes || []);
      setFolders(folderRes || []);
      setGamesFolder(infoRes ?? null);
    } catch (err: any) {
      setError(String(err));
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

  if (view === "add-game") {
    return (
      <AddGameWizard
        folders={folders}
        onDone={() => {
          loadData();
          setView("library");
        }}
        onBack={() => setView("library")}
      />
    );
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
          <button onClick={() => setView("add-game")}>+ Add</button>
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
        <p>No games found. Click "+ Add" to get started.</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "8px",
        }}
      >
        {filteredGames.map((game) => (
          <GameCard key={game.name} game={game} onClick={() => openGame(game)} />
        ))}
      </div>
    </div>
  );
};
