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
import { FaCloudDownloadAlt, FaCogs, FaSyncAlt } from "react-icons/fa";
import { GiConsoleController } from "react-icons/gi";
import logo from "../assets/logo.png";

type RemoteConfig = {
    enabled: boolean;
    host: string;
    gamesPath: string;
    yamlFileName: string;
    rsyncFlags: string;
    savePath: string;
};

type ProtonConfig = {
    compatdataPath: string;
    defaultVersion: string;
};

type DeckyfinSettings = {
    localLibraryPath: string;
    yamlFilePath: string;
    remote: RemoteConfig;
    proton: ProtonConfig;
    saveBackupPath: string;
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
    refreshedAt: string;
};

type OperationResult = {
    ok: boolean;
    message: string;
    timestamp?: string;
    failures?: string[];
    prefix_path?: string;
};

const api = {
    getSettings: callable<[], DeckyfinSettings>("get_settings"),
    saveSettings: callable<[DeckyfinSettings], DeckyfinSettings>("save_settings"),
    loadGames: callable<[], GamesResponse>("load_games"),
    downloadGame: callable<[string], OperationResult>("download_game"),
    setupPrefix: callable<[number], OperationResult>("setup_proton_prefix"),
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
    onDownload,
    onSetup,
    onSync,
    busy
}: {
    game: GameEntry;
    onDownload: () => void;
    onSetup: () => void;
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
                    <div style={{ textAlign: "right", fontSize: "0.8rem" }}>
                        <div style={{ color: game.installed ? "#8ef68e" : "#f6aa8e" }}>
                            {game.installed ? "Installed" : "Missing files"}
                        </div>
                        <div style={{ color: game.prefix_ready ? "#8ef68e" : "#f6aa8e" }}>
                            {game.prefix_ready ? "Prefix ready" : "Prefix missing"}
                        </div>
                        <div style={{ color: game.last_backup ? "#8fdaff" : "#f6aa8e" }}>
                            {game.last_backup ? `Last backup: ${game.last_backup}` : "No backup yet"}
                        </div>
                    </div>
                </div>

                <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>
                    <div>Library Path: {game.path}</div>
                    <div>Backup Path: {game.backup_path}</div>
                    {game.remote_available && (
                        <div>Remote Path: {game.remote_path ?? "(derived from folder name)"}</div>
                    )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {game.remote_available && (
                        <ButtonItem
                            layout="below"
                            disabled={busy}
                            onClick={onDownload}
                            icon={<FaCloudDownloadAlt />}
                        >
                            {busy ? "Syncing…" : "Download / Update"}
                        </ButtonItem>
                    )}
                    <ButtonItem
                        layout="below"
                        disabled={busy}
                        onClick={onSetup}
                        icon={<FaCogs />}
                    >
                        {busy ? "Working…" : "Prepare Proton Prefix"}
                    </ButtonItem>
                    <ButtonItem
                        layout="below"
                        disabled={busy}
                        onClick={onSync}
                        icon={<FaSyncAlt />}
                    >
                        {busy ? "Syncing…" : "Sync Saves"}
                    </ButtonItem>
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
            setGlobalError("Failed to read games YAML. Check the path and syntax.");
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

    const handleDownload = (name: string) => async () => {
        const key = `download-${name}`;
        markBusy(key, true);
        try {
            await callWithToaster(() => api.downloadGame(name), "Download complete");
        } finally {
            markBusy(key, false);
            loadGames();
        }
    };

    const handleSetup = (appid: number, name: string) => async () => {
        const key = `setup-${appid}`;
        markBusy(key, true);
        try {
            await callWithToaster(() => api.setupPrefix(appid), "Prefix prepared");
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
                        title="Local paths"
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
                        label="Local games folder"
                        description="Absolute path where non-Steam games live by default."
                        input={
                            <TextField
                                value={settingsDraft.localLibraryPath}
                                onChange={handleTextChange(["localLibraryPath"])}
                            />
                        }
                    />
                    <InputRow
                        label="YAML definition path"
                        description="Used when remote sync is disabled. Points to the library descriptor."
                        input={
                            <TextField
                                value={settingsDraft.yamlFilePath}
                                onChange={handleTextChange(["yamlFilePath"])}
                            />
                        }
                    />
                    <InputRow
                        label="Save backup folder"
                        description="Where backups of Proton save paths will be mirrored."
                        input={
                            <TextField
                                value={settingsDraft.saveBackupPath}
                                onChange={handleTextChange(["saveBackupPath"])}
                            />
                        }
                    />
                    <SectionHeader title="Proton" />
                    <InputRow
                        label="Compatdata path"
                        description="Root directory of Steam's compatdata (Proton prefixes)."
                        input={
                            <TextField
                                value={settingsDraft.proton.compatdataPath}
                                onChange={handleTextChange(["proton", "compatdataPath"])}
                            />
                        }
                    />
                    <InputRow
                        label="Default Proton version"
                        description="Used when a game entry does not specify proton_version."
                        input={
                            <TextField
                                value={settingsDraft.proton.defaultVersion}
                                onChange={handleTextChange(["proton", "defaultVersion"])}
                            />
                        }
                    />

                    <SectionHeader title="Remote sync" />
                    <PanelSectionRow>
                        <ToggleField
                            label="Enable remote host"
                            description="Mirror YAML, games and save backups using rsync."
                            checked={settingsDraft.remote.enabled}
                            onChange={val => mutateDraft(["remote", "enabled"], val)}
                        />
                    </PanelSectionRow>
                    {settingsDraft.remote.enabled && (
                        <Fragment>
                            <InputRow
                                label="Remote host"
                                description="Format user@host (requires SSH and rsync)."
                                input={
                                    <TextField
                                        value={settingsDraft.remote.host}
                                        onChange={handleTextChange(["remote", "host"])}
                                    />
                                }
                            />
                            <InputRow
                                label="Remote games path"
                                description="Base directory on the remote host containing the games and YAML file."
                                input={
                                    <TextField
                                        value={settingsDraft.remote.gamesPath}
                                        onChange={handleTextChange(["remote", "gamesPath"])}
                                    />
                                }
                            />
                            <InputRow
                                label="Remote YAML filename"
                                description="Defaults to games.yaml."
                                input={
                                    <TextField
                                        value={settingsDraft.remote.yamlFileName}
                                        onChange={handleTextChange(["remote", "yamlFileName"])}
                                    />
                                }
                            />
                            <InputRow
                                label="Remote save path"
                                description="Relative folder inside the remote games directory where backups are stored."
                                input={
                                    <TextField
                                        value={settingsDraft.remote.savePath}
                                        onChange={handleTextChange(["remote", "savePath"])}
                                    />
                                }
                            />
                            <InputRow
                                label="rsync flags"
                                description="Advanced: space-separated flags passed to rsync."
                                input={
                                    <TextField
                                        value={settingsDraft.remote.rsyncFlags}
                                        onChange={handleTextChange(["remote", "rsyncFlags"])}
                                    />
                                }
                            />
                        </Fragment>
                    )}
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
                            No games were found. Confirm that your YAML file follows the documented format.
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
                            onDownload={handleDownload(game.name)}
                            onSetup={handleSetup(game.steam_appid, game.name)}
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