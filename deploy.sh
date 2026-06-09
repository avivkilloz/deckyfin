#!/bin/bash

DECKYFIN_REPO_PATH=/home/deck/git/github/avivkilloz/deckyfin
DECKIFIN_PLUGIN_PATH=/home/deck/homebrew/plugins/deckyfin

cd $DECKYFIN_REPO_PATH
git pull
npm install
npm run build
sudo rm -rf $DECKIFIN_PLUGIN_PATH
sudo cp -r . $DECKIFIN_PLUGIN_PATH
sudo systemctl restart plugin_loader.service
