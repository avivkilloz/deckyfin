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
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
      >
        <path d="M19 7v10H5V7h14zm0-2H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"
          fill="currentColor" />
        <circle cx="8.5" cy="12" r="1.5" fill="currentColor" />
        <circle cx="15.5" cy="12" r="1.5" fill="currentColor" />
        <path d="M12 8c-1.1 0-2 .9-2 2h4c0-1.1-.9-2-2-2z"
          fill="currentColor" />
      </svg>
    ),
    onDismount() {
      console.log("Deckyfin unmounted");
    },
  };
});
