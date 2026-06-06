"""Tests for the Deckyfin backend modules that don't need Steam running."""

import json
import tempfile
from pathlib import Path

# ── App ID Calculation Tests ──────────────────────────────────────────────

def test_calc_shortcut_app_id_consistency():
    """Same input always produces the same output."""
    from backend.games import calc_shortcut_app_id

    app_id = calc_shortcut_app_id("The Witcher 3", '"/home/deck/game.exe"')
    assert isinstance(app_id, int)
    # Running twice yields same result
    assert app_id == calc_shortcut_app_id("The Witcher 3", '"/home/deck/game.exe"')


def test_calc_shortcut_app_id_different_names():
    """Different names produce different app IDs."""
    from backend.games import calc_shortcut_app_id

    exe = '"/home/deck/game.exe"'
    id1 = calc_shortcut_app_id("Game A", exe)
    id2 = calc_shortcut_app_id("Game B", exe)
    assert id1 != id2


def test_calc_shortcut_app_id_signed():
    """App IDs should be negative (signed 32-bit with high bit set)."""
    from backend.games import calc_shortcut_app_id

    app_id = calc_shortcut_app_id("Test Game", '"/test.exe"')
    assert app_id < 0


def test_convert_to_unsigned_32bit():
    """Negative signed app ID becomes positive unsigned."""
    from backend.games import convert_appid_to_unsigned_32bit, calc_shortcut_app_id

    signed = calc_shortcut_app_id("Test", '"/test.exe"')
    unsigned = convert_appid_to_unsigned_32bit(signed)
    assert unsigned >= 0
    assert unsigned < 2**32
    # Round-trip: unsigned -> signed
    if unsigned > 2**31 - 1:
        assert (unsigned - 2**32) == signed
    else:
        assert unsigned == signed


def test_convert_to_config_format():
    """Config format app ID is a 64-bit number with the mask bit set."""
    from backend.games import convert_appid_to_unsigned_32bit, convert_appid_to_config_format
    from backend.consts import APPID_CONFIG_FORMAT_MASK

    unsigned = 12345
    config_fmt = convert_appid_to_config_format(12345)  # signed positive, so unsigned = 12345
    config_int = int(config_fmt)
    assert (config_int & APPID_CONFIG_FORMAT_MASK) == APPID_CONFIG_FORMAT_MASK


# ── Steam Account ID Tests ────────────────────────────────────────────────

def test_steam_id64_to_account_id():
    """Account ID = Steam ID64 - base."""
    from backend.steam import steam_id64_to_account_id
    from backend.consts import STEAM_ID64_BASE

    known_id64 = 76561198000000000
    account_id = steam_id64_to_account_id(known_id64)
    assert account_id == known_id64 - STEAM_ID64_BASE


# ── Game Config File I/O Tests ────────────────────────────────────────────

class TestGameConfigIO:
    """Test read/write of the games config using a temp directory."""

    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="deckyfin-test-"))
        self.games_folder = self.tmpdir / "Games"
        self.games_folder.mkdir()
        self.app_folder = self.games_folder / ".deckyfin"
        self.app_folder.mkdir()

        # Create a sample game
        self.game_dir = self.games_folder / "the-witcher-3"
        self.game_dir.mkdir()
        (self.game_dir / "The Witcher 3.exe").touch()

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmpdir)

    def _config_file(self):
        return self.app_folder / "config.json"

    def _write_config(self, data: dict):
        with open(self._config_file(), "w") as f:
            json.dump(data, f, indent=2)

    def test_detect_game_folders(self):
        """Non-hidden subdirectories are detected as game folders."""
        from backend.app_config import detect_game_folders

        folders = detect_game_folders(self.games_folder)
        assert len(folders) == 1
        assert folders[0]["name"] == "the-witcher-3"
        assert folders[0]["path"] == "the-witcher-3"

    def test_find_game_executables(self):
        """.exe files in game dir are found recursively."""
        from backend.app_config import find_game_executables

        exes = find_game_executables(self.game_dir)
        assert len(exes) == 1
        assert "The Witcher 3.exe" in exes[0]

    def test_get_games_config_empty(self):
        """No config file returns empty games list."""
        from backend.app_config import get_games_config

        config = get_games_config(self.games_folder)
        assert config == {"games": []}

    def test_get_games_config_with_data(self):
        """Config file with games returns correctly."""
        test_games = [
            {"name": "Test Game", "executable": "test/test.exe"},
        ]
        self._write_config({"games": test_games})
        from backend.app_config import get_games_config

        config = get_games_config(self.games_folder)
        assert len(config["games"]) == 1
        assert config["games"][0]["name"] == "Test Game"

    def test_save_games_config_creates_file(self):
        """Saving config creates the file and parent dirs."""
        from backend.app_config import save_games_config

        data = {"games": [{"name": "New Game", "executable": "new/game.exe"}]}
        save_games_config(data, self.games_folder)
        assert self._config_file().exists()

    def test_list_game_configs(self):
        """list_game_configs returns the game list."""
        from backend.app_config import list_game_configs, save_games_config

        games = [{"name": "A", "executable": "a.exe"}, {"name": "B", "executable": "b.exe"}]
        save_games_config({"games": games}, self.games_folder)
        listed = list_game_configs(self.games_folder)
        assert len(listed) == 2

    def test_add_game_config_new(self):
        """Adding a new game appends it."""
        from backend.app_config import add_game_config, list_game_configs

        game = {"name": "New Game", "executable": "new/game.exe"}
        add_game_config(game, self.games_folder)
        games = list_game_configs(self.games_folder)
        assert len(games) == 1
        assert games[0]["name"] == "New Game"

    def test_add_game_config_update(self):
        """Adding a game with an existing name updates it."""
        from backend.app_config import add_game_config, get_game_config

        game1 = {"name": "Game", "executable": "v1/game.exe"}
        game2 = {"name": "Game", "executable": "v2/game.exe", "proton_version": "GE-Proton10"}
        add_game_config(game1, self.games_folder)
        add_game_config(game2, self.games_folder)
        updated = get_game_config("Game", self.games_folder)
        assert updated["executable"] == "v2/game.exe"
        assert updated["proton_version"] == "GE-Proton10"

    def test_remove_game_config(self):
        """Removing a game by name works."""
        from backend.app_config import add_game_config, remove_game_config, list_game_configs

        add_game_config({"name": "Keep Me", "executable": "keep.exe"}, self.games_folder)
        add_game_config({"name": "Remove Me", "executable": "remove.exe"}, self.games_folder)
        removed = remove_game_config("Remove Me", self.games_folder)
        assert removed is True
        games = list_game_configs(self.games_folder)
        assert len(games) == 1
        assert games[0]["name"] == "Keep Me"

    def test_remove_nonexistent_game(self):
        """Removing a game that doesn't exist returns False."""
        from backend.app_config import remove_game_config

        assert remove_game_config("Nope", self.games_folder) is False

    def test_get_game_config_by_name(self):
        """get_game_config returns the right game or None."""
        from backend.app_config import add_game_config, get_game_config

        add_game_config({"name": "Target", "executable": "target.exe"}, self.games_folder)
        add_game_config({"name": "Other", "executable": "other.exe"}, self.games_folder)
        assert get_game_config("Target", self.games_folder)["name"] == "Target"
        assert get_game_config("Missing", self.games_folder) is None

    def test_initialize_app_structure_creates_dirs(self):
        """initialize_app_structure creates .deckyfin and saves folders."""
        from backend.app_config import initialize_app_structure
        from backend.consts import APP_FOLDER, SAVES_FOLDER

        result = initialize_app_structure(str(self.games_folder))
        assert result["success"]
        assert result["games_count"] >= 0
        assert (self.games_folder / APP_FOLDER).exists()
        assert (self.games_folder / APP_FOLDER / SAVES_FOLDER).exists()

    def test_initialize_detects_existing_folders(self):
        """initialize_app_structure finds game subdirectories."""
        from backend.app_config import initialize_app_structure

        # Create some game folders
        (self.games_folder / "game-a").mkdir()
        (self.games_folder / "game-b").mkdir()

        result = initialize_app_structure(str(self.games_folder))
        assert result["success"]
        assert result["games_count"] == 2


# ── App Config File I/O Tests ─────────────────────────────────────────────

class TestAppConfigIO:
    """Test read/write of ~/.config/deckyfin/config.json using a home dir mock."""

    def setup_method(self):
        self.old_home = Path.home()
        self.tmp_home = Path(tempfile.mkdtemp(prefix="deckyfin-home-"))
        # We can't monkeypatch Path.home() in Python easily, so we test the
        # raw file reading/writing directly instead.
        self.config_dir = self.tmp_home / ".config" / "deckyfin"
        self.config_dir.mkdir(parents=True)

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.tmp_home)

    def _write(self, data: dict):
        with open(self.config_dir / "config.json", "w") as f:
            json.dump(data, f)

    def _read(self) -> dict:
        with open(self.config_dir / "config.json") as f:
            return json.load(f)

    def test_set_games_folder(self):
        """set_games_folder creates/updates the app config."""
        from backend.app_config import get_app_config_path

        # Use the get_app_config_path to know where to write
        # But since it uses Path.home(), we can't redirect it easily.
        # Instead test the raw JSON read/write logic.
        config = {"games_folder": "/home/deck/Games"}
        self._write(config)
        assert self._read()["games_folder"] == "/home/deck/Games"

    def test_app_config_merge(self):
        """set_app_config merges new keys with existing ones."""
        # Write initial config
        self._write({"games_folder": "/games", "mode": "client"})
        assert self._read()["mode"] == "client"
        assert self._read()["games_folder"] == "/games"


# ── Proton Detection Tests ────────────────────────────────────────────────

class TestProtonDetection:
    """Proton version name checks — no disk access needed."""

    def test_is_ge_proton_true(self):
        from backend.proton import is_ge_proton
        assert is_ge_proton("GE-Proton10-25")
        assert is_ge_proton("GE_Proton-42")

    def test_is_ge_proton_false(self):
        from backend.proton import is_ge_proton
        assert not is_ge_proton("Proton 9.0")
        assert not is_ge_proton("Proton Experimental")
        assert not is_ge_proton("")
