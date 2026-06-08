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
            outline: 3px solid rgba(0, 255, 0, 1) !important;
            outline-offset: 2px !important;
            background: rgba(255, 0, 0, 0.15) !important;
          }
        `}</style>
        <GameLibrary />
      </div>
    ),
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    ),
    onDismount() {
      console.log("Deckyfin unmounted");
    },
  };
});
