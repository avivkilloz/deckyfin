import { VFC, useState, useEffect, useCallback, useMemo } from "react";
import { callable } from "@decky/api";
import { Focusable } from "@decky/ui";
import { MergedGame, Source, TransferStatus } from "../types";
import { GameCard } from "../components/GameCard";
import { SettingsPage } from "../components/SettingsPage";
import { GameDetail } from "../components/GameDetail";
import { CompactTextField } from "../components/CompactTextField";

const getGames = callable<[], MergedGame[]>("get_games");
const listNonSteamGames = callable<[], { name: string }[]>("list_nonsteam_games");
const restartSteam = callable<[], { success: boolean; message?: string }>("restart_steam");
const getNeedsRestart = callable<[], boolean>("get_needs_restart");
const setNeedsRestart = callable<[value: boolean], { success: boolean }>("set_needs_restart");
const listActiveTransfers = callable<[], TransferStatus[]>("list_active_transfers");
const listAllSources = callable<[], Source[]>("list_sources");

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

type SteamFilter = "all" | "in-steam" | "not-in-steam";

const BTN: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: "0.82em",
  cursor: "pointer",
  borderRadius: "4px",
  border: "1px solid #555",
  background: "transparent",
  color: "#e0e0e0",
  whiteSpace: "nowrap" as const,
};

const CHIP = (active: boolean): React.CSSProperties => ({
  padding: "3px 10px",
  borderRadius: "12px",
  fontSize: "0.8em",
  cursor: "pointer",
  border: active ? "1px solid #27ae60" : "1px solid #555",
  color: active ? "#2ecc71" : "#aaa",
  background: active ? "#1a3a1a" : "transparent",
  margin: "0 2px",
});

export const GameLibrary: VFC = () => {
  const [games, setGames] = useState<MergedGame[]>([]);
  const [steamNames, setSteamNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "settings" | "game-detail">("library");
  const [selectedGame, setSelectedGame] = useState<MergedGame | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [needsRestart, setNeedsRestartState] = useState(false);

  // Filter state
  const [showFilterDialog, setShowFilterDialog] = useState(false);
  const [filterSourceIds, setFilterSourceIds] = useState<Set<string>>(new Set());
  const [filterSteamStatus, setFilterSteamStatus] = useState<SteamFilter>("all");
  const [showSteamPicker, setShowSteamPicker] = useState(false);

  const hasActiveFilters =
    searchQuery !== "" || filterSourceIds.size > 0 || filterSteamStatus !== "all";

  const activeFilterCount =
    (filterSourceIds.size > 0 ? 1 : 0) + (filterSteamStatus !== "all" ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery("");
    setFilterSourceIds(new Set());
    setFilterSteamStatus("all");
  };

  const toggleSourceFilter = (id: string) => {
    setFilterSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Derive unique sources from loaded games
  const allSources = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    games.forEach((g) =>
      g.sources.forEach((s) => {
        if (!seen.has(s.source_id))
          seen.set(s.source_id, { id: s.source_id, name: s.source_name });
      })
    );
    return Array.from(seen.values());
  }, [games]);

  const handleRestartSteam = useCallback(async () => {
    setRestarting(true);
    try {
      await restartSteam();
      setNeedsRestartState(false);
    } catch (_) {}
    setRestarting(false);
  }, []);

  useEffect(() => {
    getNeedsRestart().then((val) => setNeedsRestartState(val)).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const gamesRes = await getGames();
      setGames(gamesRes || []);
    } catch (err: any) {
      setError(String(err));
    }
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

  const [activeTransfers, setActiveTransfers] = useState<TransferStatus[]>([]);
  const [xferSources, setXferSources] = useState<Source[]>([]);

  useEffect(() => {
    listActiveTransfers().then((t) => setActiveTransfers(t || [])).catch(() => {});
    listAllSources().then((s) => setXferSources(s || [])).catch(() => {});
  }, []);

  const hasRunningTransfer = activeTransfers.some((t) => t.status === "running");

  useEffect(() => {
    if (!hasRunningTransfer) return;
    const poll = setInterval(async () => {
      try {
        const t = await listActiveTransfers();
        setActiveTransfers(t || []);
      } catch (_) {}
    }, 3000);
    return () => clearInterval(poll);
  }, [hasRunningTransfer]);

  const openGame = (game: MergedGame) => {
    setSelectedGame(game);
    setView("game-detail");
  };

  const filteredGames = games.filter((g) => {
    if (searchQuery && !g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      return false;
    if (filterSourceIds.size > 0 && !g.sources.some((s) => filterSourceIds.has(s.source_id)))
      return false;
    if (filterSteamStatus === "in-steam" && !steamNames.has(g.name)) return false;
    if (filterSteamStatus === "not-in-steam" && steamNames.has(g.name)) return false;
    return true;
  });

  if (view === "settings") {
    return <SettingsPage onBack={() => { loadData(); setView("library"); }} />;
  }

  if (view === "game-detail" && selectedGame) {
    return (
      <GameDetail
        game={selectedGame}
        onBack={async () => {
          await loadData();
          listActiveTransfers().then((t) => setActiveTransfers(t || [])).catch(() => {});
          setView("library");
        }}
        onNeedsRestart={() => {
          setNeedsRestartState(true);
          setNeedsRestart(true).catch(() => {});
          loadData();
        }}
      />
    );
  }

  return (
    <div style={{ padding: "8px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <Focusable style={{ display: "flex", gap: "6px" }}>
          <Focusable
            onActivate={handleRestartSteam}
            onClick={handleRestartSteam}
            focusClassName="is-focused"
            style={{
              ...BTN,
              border: needsRestart ? "1px solid #27ae60" : "1px solid #555",
              color: needsRestart ? "#2ecc71" : "#e0e0e0",
            }}
          >
            {restarting ? "…" : "↺ Restart Steam"}
          </Focusable>
          <Focusable
            onActivate={() => setView("settings")}
            onClick={() => setView("settings")}
            focusClassName="is-focused"
            style={BTN}
          >
            ⚙ Settings
          </Focusable>
        </Focusable>
      </div>

      {/* Active Transfers */}
      {activeTransfers.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          {activeTransfers.map((xfer) => {
            const pct =
              xfer.total_bytes > 0
                ? Math.round((xfer.bytes_copied / xfer.total_bytes) * 100)
                : 0;
            const fromName =
              xferSources.find((s) => s.id === xfer.from_source_id)?.name ?? xfer.from_source_id;
            const toName =
              xferSources.find((s) => s.id === xfer.to_source_id)?.name ?? xfer.to_source_id;
            return (
              <div
                key={xfer.transfer_id}
                style={{
                  border: "1px solid #444",
                  borderRadius: "4px",
                  padding: "8px 10px",
                  marginBottom: "6px",
                  background: "#1a1a1a",
                  fontSize: "0.82em",
                }}
              >
                {xfer.status === "running" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span>
                        ▸ <strong>{xfer.game_name}</strong>: {fromName} → {toName}
                      </span>
                      <span style={{ color: "#aaa" }}>{pct}%</span>
                    </div>
                    <div style={{ background: "#333", borderRadius: "2px", height: "4px", marginBottom: "3px" }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          background: "#0078d4",
                          borderRadius: "2px",
                          height: "100%",
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <span style={{ color: "#666" }}>
                      {fmtBytes(xfer.bytes_copied)} / {fmtBytes(xfer.total_bytes)}
                    </span>
                  </>
                )}
                {xfer.status === "done" && (
                  <span style={{ color: "#2ecc71" }}>
                    ✓ <strong>{xfer.game_name}</strong> copied: {fromName} → {toName}
                  </span>
                )}
                {xfer.status === "failed" && (
                  <span style={{ color: "tomato" }}>
                    ✗ <strong>{xfer.game_name}</strong> failed: {xfer.error ?? "Transfer failed"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Search + Filter row */}
      <Focusable
        focusClassName=""
        style={{ display: "flex", gap: "6px", marginBottom: showFilterDialog ? "4px" : "12px", alignItems: "center" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <CompactTextField
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Games"
            style={{ width: "100%" }}
          />
        </div>
        <Focusable
          onActivate={() => setShowFilterDialog((v) => !v)}
          onClick={() => setShowFilterDialog((v) => !v)}
          focusClassName="is-focused"
          style={{
            ...BTN,
            padding: "6px 9px",
            border: (showFilterDialog || activeFilterCount > 0) ? "1px solid #3498db" : "1px solid #555",
            color: (showFilterDialog || activeFilterCount > 0) ? "#5dade2" : "#e0e0e0",
            position: "relative",
          }}
        >
          ≡{activeFilterCount > 0 && (
            <span style={{
              position: "absolute", top: "-4px", right: "-4px",
              background: "#3498db", color: "#fff",
              borderRadius: "50%", fontSize: "0.65em",
              width: "14px", height: "14px",
              display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1,
            }}>
              {activeFilterCount}
            </span>
          )}
        </Focusable>
        {hasActiveFilters && (
          <Focusable
            onActivate={clearFilters}
            onClick={clearFilters}
            focusClassName="is-focused"
            style={{ ...BTN, padding: "6px 9px", border: "1px solid #555", color: "#aaa" }}
          >
            ✕
          </Focusable>
        )}
      </Focusable>

      {/* Filter dialog */}
      {showFilterDialog && (
        <div style={{ border: "1px solid #444", borderRadius: "6px", padding: "10px", marginBottom: "12px" }}>
          {/* Sources */}
          {allSources.length > 0 && (
            <>
              <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Sources
              </div>
              <Focusable
                focusClassName=""
                style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}
              >
                {allSources.map((src) => (
                  <Focusable
                    key={src.id}
                    onActivate={() => toggleSourceFilter(src.id)}
                    onClick={() => toggleSourceFilter(src.id)}
                    focusClassName="is-focused"
                    style={CHIP(filterSourceIds.has(src.id))}
                  >
                    {src.name}
                  </Focusable>
                ))}
              </Focusable>
            </>
          )}

          {/* Steam status */}
          <div style={{ fontSize: "0.75em", color: "#888", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Steam Status
          </div>
          <Focusable
            onActivate={() => setShowSteamPicker((p) => !p)}
            onClick={() => setShowSteamPicker((p) => !p)}
            focusClassName="is-focused"
            style={{
              ...BTN,
              display: "inline-block",
              padding: "4px 12px",
              marginBottom: showSteamPicker ? "4px" : "0",
              color: filterSteamStatus !== "all" ? "#e0e0e0" : "#888",
            }}
          >
            {filterSteamStatus === "all" ? "— All —" : filterSteamStatus === "in-steam" ? "In Steam" : "Not in Steam"}
          </Focusable>
          {showSteamPicker && (
            <div style={{ border: "1px solid #555", borderRadius: "4px", padding: "2px 0" }}>
              {(["all", "in-steam", "not-in-steam"] as const).map((opt) => (
                <Focusable
                  key={opt}
                  onActivate={() => { setFilterSteamStatus(opt); setShowSteamPicker(false); }}
                  onClick={() => { setFilterSteamStatus(opt); setShowSteamPicker(false); }}
                  focusClassName="is-focused"
                  style={{ margin: "0 2px", padding: "4px 10px", cursor: "pointer", fontSize: "0.85em", borderBottom: "1px solid #333", color: filterSteamStatus === opt ? "#0078d4" : "#ccc" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {opt === "all" ? "— All —" : opt === "in-steam" ? "In Steam" : "Not in Steam"}
                </Focusable>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Game list */}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && games.length === 0 && (
        <p>No games found. Add sources in Settings, then Rescan.</p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "8px",
        }}
      >
        {filteredGames.map((game) => (
          <GameCard
            key={game.name}
            game={game.sources[0]?.config ?? { name: game.name, executable: "" }}
            isInSteam={steamNames.has(game.name)}
            sourceCount={game.sources.length}
            onClick={() => openGame(game)}
          />
        ))}
      </div>
    </div>
  );
};
