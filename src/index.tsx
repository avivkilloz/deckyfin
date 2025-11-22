import {
    ButtonItem,
    PanelSection,
    PanelSectionRow,
    TextField,
    ToggleField,
    Focusable
} from "@decky/ui";
import {
    callable,
    definePlugin,
    toaster
} from "@decky/api";
import React, {
    ChangeEvent,
    Fragment,
    ReactNode,
    useEffect,
    useMemo,
    useState
} from "react";
import { FaCloudDownloadAlt, FaSyncAlt, FaTrash, FaCheck } from "react-icons/fa";
import { GiConsoleController } from "react-icons/gi";
import logo from "../assets/logo.png";

type ProtonConfig = {
    compatdataPath: string;
    defaultVersion: string;
};

type DeckyfinSettings = {
    remoteHost: string;
    remoteConfigPath: string;
    localGamesPath: string;
    proton: ProtonConfig;
    saveBackupPath: string;
    rsyncFlags: string;
};

type GameEntry = {
    name: string;
    path: string;
    defined_path?: string;
    steam_appid: number;
    proton_version: string;
    proton_dependencies: string[];
    proton_sync_paths: string[];
    remote_path?: string;
    executable?: string;
    categories?: string[];
    launch_options?: string;
    installed: boolean;
    prefix_ready: boolean;
    prefix_path: string;
    backup_path: string;
    last_backup?: string | null;
    remote_available: boolean;
};

type GamesResponse = {
    games: GameEntry[];
    source: string;
    savesPath?: string;
    refreshedAt: string;
};

type OperationResult = {
    ok: boolean;
    message: string;
    timestamp?: string;
    failures?: string[];
    prefix_path?: string;
    steps?: string[];
};

const api = {
    getSettings: callable<[], DeckyfinSettings>("get_settings"),
    saveSettings: callable<[DeckyfinSettings], DeckyfinSettings>("save_settings"),
    loadGames: callable<[], GamesResponse>("load_games"),
    installGame: callable<[string], OperationResult>("install_game"),
    removeGame: callable<[string], OperationResult>("remove_game"),
    syncGame: callable<[string], OperationResult>("sync_game_saves"),
    syncAll: callable<[], OperationResult>("sync_all_saves"),
};

const SectionHeader = ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
        <span style={{ fontSize: "1rem", fontWeight: 600 }}>{title}</span>
        {actions}
    </div>
);

const InputRow = ({ label, description, input }: {
    label: string;
    description?: string;
    input: ReactNode;
}) => (
    <PanelSectionRow>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
            <div style={{ fontWeight: 600 }}>{label}</div>
            {description && <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{description}</div>}
            {input}
        </div>
    </PanelSectionRow>
);

const GameCard = ({
    game,
    onInstall,
    onRemove,
    onSync,
    busy
}: {
    game: GameEntry;
    onInstall: () => void;
    onRemove: () => void;
    onSync: () => void;
    busy: boolean;
}) => (
    <PanelSectionRow>
        <Focusable style={{ width: "100%" }}>
            <div style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <div style={{ fontSize: "1rem", fontWeight: 600 }}>{game.name}</div>
                        <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>AppID {game.steam_appid} · Proton {game.proton_version}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: "0.8rem", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, color: game.installed ? "#8ef68e" : "#f6aa8e" }}>
                            {game.installed && <FaCheck />}
                            {game.installed ? "Installed" : "Not installed"}
                        </div>
                        {game.categories && game.categories.length > 0 && (
                            <div style={{ fontSize: "0.7rem", opacity: 0.7 }}>
                                {game.categories.join(", ")}
                            </div>
                        )}
                        {game.last_backup && (
                            <div style={{ color: "#8fdaff", fontSize: "0.7rem" }}>
                                Last backup: {new Date(game.last_backup).toLocaleDateString()}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                    <div>Library Path: {game.path}</div>
                    <div>Backup Path: {game.backup_path}</div>
                    {game.executable && (
                        <div>Executable: {game.executable}</div>
                    )}
                    {game.launch_options && (
                        <div style={{ fontFamily: "monospace", fontSize: "0.75rem", marginTop: 4 }}>
                            Launch Options: {game.launch_options}
                        </div>
                    )}
                    {game.remote_available && (
                        <div>Remote Path: {game.remote_path ?? "(derived from folder name)"}</div>
                    )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {!game.installed ? (
                        <ButtonItem
                            layout="below"
                            disabled={busy || !game.remote_available}
                            onClick={onInstall}
                            icon={<FaCloudDownloadAlt />}
                        >
                            {busy ? "Installing…" : "Install Game"}
                        </ButtonItem>
                    ) : (
                        <>
                            <ButtonItem
                                layout="below"
                                disabled={busy}
                                onClick={onRemove}
                                icon={<FaTrash />}
                            >
                                {busy ? "Removing…" : "Remove Game"}
                            </ButtonItem>
                            <ButtonItem
                                layout="below"
                                disabled={busy}
                                onClick={onSync}
                                icon={<FaSyncAlt />}
                            >
                                {busy ? "Syncing…" : "Backup Saves"}
                            </ButtonItem>
                        </>
                    )}
                </div>
            </div>
        </Focusable>
    </PanelSectionRow>
);

function Content() {
    const [settings, setSettings] = useState<DeckyfinSettings | null>(null);
    const [settingsDraft, setSettingsDraft] = useState<DeckyfinSettings | null>(null);
    const [settingsDirty, setSettingsDirty] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);

    const [games, setGames] = useState<GameEntry[]>([]);
    const [gamesMeta, setGamesMeta] = useState<{ source: string; refreshedAt: string } | null>(null);
    const [gamesLoading, setGamesLoading] = useState(false);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});

    const disableActions = gamesLoading || savingSettings;

    const markBusy = (key: string, busy: boolean) => {
        setBusyMap(prev => ({ ...prev, [key]: busy }));
    };

    const mutateDraft = (path: string[], value: string | boolean) => {
        setSettingsDraft(prev => {
            if (!prev) return prev;
            const clone: any = { ...prev };
            let cursor: any = clone;
            for (let i = 0; i < path.length - 1; i++) {
                const segment = path[i];
                cursor[segment] = { ...(cursor[segment] ?? {}) };
                cursor = cursor[segment];
            }
            cursor[path[path.length - 1]] = value;
            return clone;
        });
        setSettingsDirty(true);
    };

    const handleTextChange = (path: string[]) => (event: ChangeEvent<HTMLInputElement>) => {
        mutateDraft(path, event.target.value);
    };

    const loadSettings = async () => {
        try {
            const loaded = await api.getSettings();
            setSettings(loaded);
            setSettingsDraft(loaded);
            setSettingsDirty(false);
        } catch (error) {
            console.error(error);
            setGlobalError("Unable to load plugin settings");
        }
    };

    const loadGames = async () => {
        setGamesLoading(true);
        setGlobalError(null);
        try {
            const payload = await api.loadGames();
            setGames(payload.games);
            setGamesMeta({ source: payload.source, refreshedAt: payload.refreshedAt });
        } catch (error) {
            console.error(error);
            setGlobalError("Failed to read config file. Check remote host, config path, and JSON syntax.");
        } finally {
            setGamesLoading(false);
        }
    };

    const persistSettings = async () => {
        if (!settingsDraft || savingSettings) return;
        setSavingSettings(true);
        try {
            const updated = await api.saveSettings(settingsDraft);
            setSettings(updated);
            setSettingsDraft(updated);
            setSettingsDirty(false);
            toaster.toast({
                title: "Deckyfin",
                body: "Settings saved",
            });
        } catch (error) {
            console.error(error);
            toaster.toast({
                title: "Deckyfin",
                body: "Unable to save settings",
                critical: true,
            });
        } finally {
            setSavingSettings(false);
        }
    };

    const callWithToaster = async (action: () => Promise<OperationResult>, success: string) => {
        try {
            const result = await action();
            toaster.toast({
                title: "Deckyfin",
                body: result.message ?? success,
            });
            return result;
        } catch (error: any) {
            toaster.toast({
                title: "Deckyfin",
                body: error?.message ?? "Operation failed",
                critical: true,
            });
            throw error;
        }
    };

    const handleInstall = (name: string) => async () => {
        const key = `install-${name}`;
        markBusy(key, true);
        try {
            const result = await callWithToaster(() => api.installGame(name), "Installation complete");
            if (result.steps && result.steps.length > 0) {
                toaster.toast({
                    title: "Installation steps",
                    body: result.steps.join(", "),
                });
            }
        } finally {
            markBusy(key, false);
            loadGames();
        }
    };

    const handleRemove = (name: string) => async () => {
        const key = `remove-${name}`;
        markBusy(key, true);
        try {
            const result = await callWithToaster(() => api.removeGame(name), "Game removed");
            if (result.steps && result.steps.length > 0) {
                toaster.toast({
                    title: "Removal steps",
                    body: result.steps.join(", "),
                });
            }
        } finally {
            markBusy(key, false);
            loadGames();
        }
    };

    const handleSync = (name: string) => async () => {
        const key = `sync-${name}`;
        markBusy(key, true);
        try {
            await callWithToaster(() => api.syncGame(name), "Saves synced");
        } finally {
            markBusy(key, false);
            loadGames();
        }
    };

    const handleSyncAll = async () => {
        markBusy("sync-all", true);
        try {
            await callWithToaster(() => api.syncAll(), "Saves synced for all games");
        } finally {
            markBusy("sync-all", false);
            loadGames();
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        if (settings) {
            loadGames();
        }
    }, [settings]);

    const sortedGames = useMemo(
        () => [...games].sort((a, b) => a.name.localeCompare(b.name)),
        [games]
    );

    return (
        <Fragment>
            <PanelSection title="Deckyfin">
                <PanelSectionRow>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <img src={logo} style={{ width: 54, borderRadius: 8 }} />
                        <div>
                            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>Manage your non-Steam library</div>
                            <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                                Sync Proton prefixes, saves and optionally mirror games from a remote server.
                            </div>
                        </div>
                    </div>
                </PanelSectionRow>
                {globalError && (
                    <PanelSectionRow>
                        <div style={{ color: "#ff8e8e" }}>{globalError}</div>
                    </PanelSectionRow>
                )}
            </PanelSection>

            {settingsDraft && (
                <PanelSection title="Configuration">
                    <SectionHeader
                        title="Settings"
                        actions={
                            <ButtonItem
                                layout="below"
                                onClick={persistSettings}
                                disabled={!settingsDirty || savingSettings}
                            >
                                {savingSettings ? "Saving…" : "Save settings"}
                            </ButtonItem>
                        }
                    />
                    <InputRow
                        label="Remote host address"
                        description="Format: user@host (requires SSH access and rsync on both ends)."
                        input={
                            <TextField
                                value={settingsDraft.remoteHost}
                                onChange={handleTextChange(["remoteHost"])}
                            />
                        }
                    />
                    <InputRow
                        label="Remote config file path"
                        description="Full path to deckyfin-config.json on remote host (e.g., /path/to/deckyfin-config.json)."
                        input={
                            <TextField
                                value={settingsDraft.remoteConfigPath}
                                onChange={handleTextChange(["remoteConfigPath"])}
                            />
                        }
                    />
                    <InputRow
                        label="Local games folder"
                        description="Destination folder on Steam Deck where games will be downloaded."
                        input={
                            <TextField
                                value={settingsDraft.localGamesPath}
                                onChange={handleTextChange(["localGamesPath"])}
                            />
                        }
                    />
                </PanelSection>
            )}

            <PanelSection title="Games">
                <SectionHeader
                    title={gamesMeta ? `Library (${sortedGames.length})` : "Library"}
                    actions={
                        <div style={{ display: "flex", gap: 8 }}>
                            <ButtonItem
                                layout="below"
                                onClick={loadGames}
                                icon={<GiConsoleController />}
                                disabled={gamesLoading || disableActions}
                            >
                                {gamesLoading ? "Refreshing…" : "Refresh"}
                            </ButtonItem>
                            <ButtonItem
                                layout="below"
                                onClick={handleSyncAll}
                                icon={<FaSyncAlt />}
                                disabled={disableActions}
                            >
                                {busyMap["sync-all"] ? "Syncing…" : "Sync all saves"}
                            </ButtonItem>
                        </div>
                    }
                />
                {gamesMeta && (
                    <PanelSectionRow>
                        <div style={{ fontSize: "0.75rem", opacity: 0.75 }}>
                            Source: {gamesMeta.source} · Updated: {gamesMeta.refreshedAt}
                        </div>
                    </PanelSectionRow>
                )}
                {sortedGames.length === 0 && (
                    <PanelSectionRow>
                        <div style={{ opacity: 0.7 }}>
                            No games were found. Confirm that your config file has a "games" array and remote settings are correct.
                        </div>
                    </PanelSectionRow>
                )}
                {sortedGames.map(game => {
                    const busy =
                        busyMap[`download-${game.name}`] ||
                        busyMap[`setup-${game.steam_appid}`] ||
                        busyMap[`sync-${game.name}`] ||
                        disableActions;
                    return (
                        <GameCard
                            key={game.name}
                            game={game}
                            busy={busy}
                            onInstall={handleInstall(game.name)}
                            onRemove={handleRemove(game.name)}
                            onSync={handleSync(game.name)}
                        />
                    );
                })}
            </PanelSection>
        </Fragment>
    );
}

export default definePlugin(() => {
    return {
        name: "Deckyfin",
        titleView: <div style={{ fontWeight: 600 }}>Deckyfin</div>,
        content: <Content />,
        icon: <FaCloudDownloadAlt />,
        onDismount() {
            console.log("[Deckyfin] frontend dismount");
        },
    };
});