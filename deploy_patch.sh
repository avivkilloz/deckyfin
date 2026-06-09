#!/bin/bash
# Deploy patched steam_games.py to the plugin dir
cp /home/deck/git/github/avivkilloz/deckyfin/py_modules/steam_games.py /home/deck/homebrew/plugins/deckyfin/py_modules/steam_games.py
find /home/deck/homebrew/plugins/deckyfin/py_modules/ -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null
find /home/deck/homebrew/plugins/deckyfin/py_modules/ -name '*.pyc' -delete 2>/dev/null
echo "Deployed successfully"
