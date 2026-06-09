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
        width="24"
        height="24"
      >
        <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
          <rect x="0" y="7" width="24" height="10" rx="3"/>
          <path d="M9 10v4M7 12h4" />
          <circle cx="11" cy="12" r="2" fill="currentColor" />
          <circle cx="15" cy="12" r="2" fill="currentColor" />
        </g>
      </svg>
    ),
    onDismount() {
      console.log("Deckyfin unmounted");
    },
  };
});
