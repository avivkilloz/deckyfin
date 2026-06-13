"""Tests for deckyfin_transfer module."""
import sys
import tempfile
from pathlib import Path

_py_modules = str(Path(__file__).resolve().parent.parent / "py_modules")
if _py_modules not in sys.path:
    sys.path.insert(0, _py_modules)


def test_calculate_total_size_empty():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_transfer import calculate_total_size
        assert calculate_total_size(Path(tmp)) == 0


def test_calculate_total_size_nested():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_transfer import calculate_total_size
        root = Path(tmp)
        (root / "a.exe").write_bytes(b"x" * 100)
        (root / "sub").mkdir()
        (root / "sub" / "b.dll").write_bytes(b"y" * 200)
        assert calculate_total_size(root) == 300


def test_copy_game_folder_copies_files():
    with tempfile.TemporaryDirectory() as src_tmp, tempfile.TemporaryDirectory() as dst_tmp:
        from deckyfin_transfer import copy_game_folder
        src = Path(src_tmp) / "Game"
        src.mkdir()
        (src / "game.exe").write_bytes(b"A" * 50)
        (src / "sub").mkdir()
        (src / "sub" / "data.pak").write_bytes(b"B" * 100)

        dst = Path(dst_tmp) / "Game"
        calls = []
        copy_game_folder(src, dst, lambda b: calls.append(b), owner_uid=0, owner_gid=0)

        assert (dst / "game.exe").read_bytes() == b"A" * 50
        assert (dst / "sub" / "data.pak").read_bytes() == b"B" * 100
        assert calls[-1] == 150


def test_copy_game_folder_cleans_up_on_cancel():
    import pytest
    with tempfile.TemporaryDirectory() as src_tmp, tempfile.TemporaryDirectory() as dst_tmp:
        from deckyfin_transfer import copy_game_folder
        src = Path(src_tmp) / "Game"
        src.mkdir()
        (src / "game.exe").write_bytes(b"A" * 50)
        (src / "b.pak").write_bytes(b"B" * 100)

        dst = Path(dst_tmp) / "Game"
        flag = {}
        call_count = [0]

        def progress(b):
            call_count[0] += 1
            if call_count[0] >= 1:
                flag["cancelled"] = True

        with pytest.raises(RuntimeError, match="[Cc]ancelled"):
            copy_game_folder(src, dst, progress, owner_uid=0, owner_gid=0, cancelled_flag=flag)

        assert not dst.exists()


def test_copy_game_config_fields_portable_only():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_config import save_games_config
        from deckyfin_transfer import copy_game_config_fields

        src = Path(tmp) / "src"
        dst = Path(tmp) / "dst"
        src.mkdir()
        dst.mkdir()
        (src / ".deckyfin").mkdir()
        (dst / ".deckyfin").mkdir()

        save_games_config({"games": [{
            "name": "MyGame", "path": "MyGame",
            "executable": "MyGame/game.exe", "start_dir": "MyGame",
            "steam_app_id": 12345, "proton_version": "GE-Proton10",
            "proton_dependencies": ["vcrun2022"], "proton_sync_paths": [],
            "categories": ["RPG"], "launch_options": "--fullscreen",
            "collections": ["Favorites"],
            "steam_snapshot": "should_not_copy", "deps_snapshot": ["vcrun2022"],
            "needs_restart_after_add": True,
        }]}, src)

        save_games_config({"games": [{
            "name": "MyGame", "path": "MyGame", "executable": "",
            "proton_version": "", "proton_dependencies": [],
            "steam_snapshot": "dest_snapshot",
        }]}, dst)

        copy_game_config_fields("MyGame", src, dst)

        from deckyfin_config import get_games_config
        result = get_games_config(dst)
        game = next(g for g in result["games"] if g["name"] == "MyGame")

        assert game["proton_version"] == "GE-Proton10"
        assert game["proton_dependencies"] == ["vcrun2022"]
        assert game["executable"] == "MyGame/game.exe"
        assert game["steam_app_id"] == 12345
        assert game["categories"] == ["RPG"]
        # Non-portable fields must NOT be copied
        assert game.get("steam_snapshot") == "dest_snapshot"
        assert game.get("needs_restart_after_add") is not True


def test_copy_game_config_fields_creates_entry_if_missing():
    with tempfile.TemporaryDirectory() as tmp:
        from deckyfin_config import save_games_config, get_games_config
        from deckyfin_transfer import copy_game_config_fields

        src = Path(tmp) / "src"
        dst = Path(tmp) / "dst"
        src.mkdir(); dst.mkdir()
        (src / ".deckyfin").mkdir(); (dst / ".deckyfin").mkdir()

        save_games_config({"games": [{"name": "NewGame", "path": "NewGame",
            "executable": "NewGame/g.exe", "proton_version": "GE9",
            "proton_dependencies": [], "proton_sync_paths": [],
            "categories": [], "launch_options": "", "collections": [],
        }]}, src)
        save_games_config({"games": []}, dst)

        copy_game_config_fields("NewGame", src, dst)

        games = get_games_config(dst)["games"]
        assert any(g["name"] == "NewGame" and g["proton_version"] == "GE9" for g in games)
