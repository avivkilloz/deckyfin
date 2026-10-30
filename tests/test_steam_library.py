"""Tests for deckyfin_steam_library — installed Store game discovery."""

import json
import sys
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def _reload(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    import importlib, deckyfin_config, deckyfin_sources, deckyfin_steam_library
    importlib.reload(deckyfin_config)
    importlib.reload(deckyfin_sources)
    importlib.reload(deckyfin_steam_library)
    return deckyfin_steam_library


def _manifest(lib: Path, appid: int, name: str, flags: int = 4, installdir: str = None, size: int = 100):
    d = lib / "steamapps"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"appmanifest_{appid}.acf").write_text(
        '"AppState"\n{\n'
        f'\t"appid"\t\t"{appid}"\n'
        f'\t"name"\t\t"{name}"\n'
        f'\t"StateFlags"\t\t"{flags}"\n'
        f'\t"installdir"\t\t"{installdir or name}"\n'
        f'\t"SizeOnDisk"\t\t"{size}"\n'
        '}\n'
    )


def _library_folders(steam_root: Path, *paths: Path):
    d = steam_root / "steamapps"
    d.mkdir(parents=True, exist_ok=True)
    body = "".join(f'\t"{i}"\n\t{{\n\t\t"path"\t\t"{p}"\n\t}}\n' for i, p in enumerate(paths))
    (d / "libraryfolders.vdf").write_text('"libraryfolders"\n{\n' + body + '}\n')


def test_list_library_folders_reads_all_existing(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    extra = tmp_path / "SD" / "SteamLibrary"
    (extra / "steamapps").mkdir(parents=True)
    _library_folders(root, root, extra, tmp_path / "gone")
    assert mod.list_library_folders(root) == [root, extra]


def test_list_library_folders_fallback_to_root(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "steamapps").mkdir(parents=True)
    assert mod.list_library_folders(root) == [root]


def test_list_installed_games_filters_and_detects_prefix(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    extra = tmp_path / "SD" / "SteamLibrary"
    _library_folders(root, root, extra)
    _manifest(root, 292030, "The Witcher 3", flags=4, installdir="The Witcher 3", size=5)
    _manifest(extra, 216150, "MapleStory", flags=6)          # update pending → kept
    _manifest(extra, 111, "Downloading", flags=1026)         # not installed → skipped
    _manifest(root, 1493710, "Proton Experimental")          # tool by name
    _manifest(root, 228980, "Steamworks Common Redistributables")  # tool by appid
    _manifest(root, 4183110, "Steam Linux Runtime 4.0")
    (extra / "steamapps" / "compatdata" / "216150" / "pfx").mkdir(parents=True)

    games = mod.list_installed_games(root, {"292030": "proton_experimental"}, {"216150": "-dx11"})
    by_id = {g["appid"]: g for g in games}
    assert set(by_id) == {292030, 216150}

    w = by_id[292030]
    assert w["name"] == "The Witcher 3"
    assert w["library_path"] == str(root)
    assert w["install_dir"] == str(root / "steamapps" / "common" / "The Witcher 3")
    assert w["prefix_path"] is None
    assert w["proton_version"] == "proton_experimental"
    assert w["has_prefix"] is True          # forced Proton counts (rule A)
    assert w["size_on_disk"] == 5
    assert w["steam_launch_options"] == ""

    m = by_id[216150]
    assert m["library_path"] == str(extra)
    assert m["prefix_path"] == str(extra / "steamapps" / "compatdata" / "216150" / "pfx")
    assert m["has_prefix"] is True
    assert m["proton_version"] is None
    assert m["steam_launch_options"] == "-dx11"


def test_has_prefix_false_without_prefix_or_proton(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    _library_folders(root, root)
    _manifest(root, 3139440, "GunZ")
    [g] = mod.list_installed_games(root, {}, {})
    assert g["has_prefix"] is False


def test_read_compat_mapping(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "config").mkdir(parents=True)
    (root / "config" / "config.vdf").write_text(
        '"InstallConfigStore"\n{\n"Software"\n{\n"Valve"\n{\n"Steam"\n{\n'
        '"CompatToolMapping"\n{\n"292030"\n{\n"name"\t"proton_experimental"\n"config"\t""\n"priority"\t"250"\n}\n}\n'
        '}\n}\n}\n}\n'
    )
    assert mod.read_compat_mapping(root) == {"292030": "proton_experimental"}
    assert mod.read_compat_mapping(tmp_path / "nope") == {}


def test_read_launch_options(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    cfg = root / "userdata" / "42" / "config"
    cfg.mkdir(parents=True)
    (cfg / "localconfig.vdf").write_text(
        '"UserLocalConfigStore"\n{\n"Software"\n{\n"Valve"\n{\n"Steam"\n{\n'
        '"apps"\n{\n"216150"\n{\n"LaunchOptions"\t"-dx11 %command%"\n}\n"292030"\n{\n"LastPlayed"\t"1"\n}\n}\n'
        '}\n}\n}\n}\n'
    )
    assert mod.read_launch_options(root, "42") == {"216150": "-dx11 %command%"}
    assert mod.read_launch_options(root, "missing") == {}


def _store(tmp_path, games):
    d = tmp_path / ".config" / "deckyfin" / "steam_library" / ".deckyfin"
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text(json.dumps({"games": games}))
    return d / "config.json"


def _setup_one_game(tmp_path):
    root = tmp_path / "Steam"
    _library_folders(root, root)
    _manifest(root, 216150, "MapleStory")
    (root / "steamapps" / "compatdata" / "216150" / "pfx").mkdir(parents=True)
    return root


def test_load_library_games_seeds_from_steam(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    monkeypatch.setattr(mod, "read_compat_mapping", lambda r: {"216150": "proton_9"})
    monkeypatch.setattr(mod, "read_launch_options", lambda r, u: {"216150": "-dx11"})
    [g] = mod.load_library_games(root, "42")
    assert g["id"] == "steam-216150"
    assert g["steam_app_id"] == 216150
    assert g["launch_options"] == "-dx11"
    assert g["selected_launchers"] == []
    assert g["proton_version"] == "proton_9"
    assert g["collections"] == []
    assert g["has_prefix"] is True
    snap = json.loads(g["steam_snapshot"])
    assert list(snap) == ["name", "launch_options", "proton_version", "collections"]
    assert snap == {"name": "MapleStory", "launch_options": "-dx11", "proton_version": "proton_9", "collections": []}


def test_load_library_games_store_values_win(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    _store(tmp_path, [{"name": "MapleStory", "launch_options": "", "proton_version": None,
                       "selected_launchers": ["MangoHud"], "proton_dependencies": ["vcrun2019"],
                       "collections": ["MMO"]}])
    monkeypatch.setattr(mod, "read_compat_mapping", lambda r: {"216150": "proton_9"})
    monkeypatch.setattr(mod, "read_launch_options", lambda r, u: {"216150": "-dx11"})
    [g] = mod.load_library_games(root, "42")
    assert g["launch_options"] == ""
    assert g["proton_version"] is None
    assert g["selected_launchers"] == ["MangoHud"]
    assert g["proton_dependencies"] == ["vcrun2019"]
    assert g["collections"] == ["MMO"]
    snap = json.loads(g["steam_snapshot"])
    assert snap["collections"] == []


def test_load_library_games_prunes_uninstalled(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = _setup_one_game(tmp_path)
    cfg = _store(tmp_path, [{"name": "MapleStory"}, {"name": "Uninstalled"}])
    mod.load_library_games(root, "42")
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["MapleStory"]


def test_load_library_games_no_prune_when_empty(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    root = tmp_path / "Steam"
    (root / "steamapps").mkdir(parents=True)
    cfg = _store(tmp_path, [{"name": "MapleStory"}])
    assert mod.load_library_games(root, "42") == []
    assert [g["name"] for g in json.loads(cfg.read_text())["games"]] == ["MapleStory"]


def test_load_source_games_dispatches_steam_library(tmp_path, monkeypatch):
    mod = _reload(tmp_path, monkeypatch)
    import deckyfin_sources
    monkeypatch.setattr(mod, "load_library_games", lambda *a, **k: [{"id": "steam-1", "name": "X"}])
    src = {"id": "steam-library", "type": "steam_library", "path": None, "builtin": True}
    assert deckyfin_sources.load_source_games(src) == [{"id": "steam-1", "name": "X"}]
