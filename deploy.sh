#!/bin/bash

cd /home/avivilloz/git/avivkilloz/deckyfin 
git pull
npm install
npm run build
sudo rm -rf /home/avivilloz/homebrew/plugins/deckyfin
sudo cp -r . /home/avivilloz/homebrew/plugins/deckyfin
sudo systemctl restart plugin_loader.service