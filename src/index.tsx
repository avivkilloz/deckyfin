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
        <path d="M20 6H4c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"
          fill="currentColor" />
        <circle cx="8" cy="12" r="2" fill="currentColor" />
        <circle cx="16" cy="12" r="2" fill="currentColor" />
        <path d="M11 9v2H9v2h2v2h2v-2h2v-2h-2V9h-2z"
          fill="currentColor" />
      </svg>
    ),
    onDismount() {
      console.log("Deckyfin unmounted");
    },
  };
});
