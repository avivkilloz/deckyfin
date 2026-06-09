import { definePlugin } from "@decky/api";
import { GameLibrary } from "./components/GameLibrary";

export default definePlugin(() => {
  return {
    name: "Deckyfin",
    title: <div>Deckyfin</div>,
    content: (
      <div id="deckyfin-wrap">
        <style>{`
          .gpfocus,
           .is-focused {
             box-shadow: 0 0 0 2px #0078d4 !important;
           }
          `}</style>
        <GameLibrary />
      </div>
    ),
    icon: <span style={{ fontSize: "20px", lineHeight: 1 }}>🎮</span>,
    onDismount() {
      console.log("Deckyfin unmounted");
    },
  };
});
