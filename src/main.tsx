import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Issue #39: self-hosted webfonts (offline deploy — no CDN). Only the
// subsets we need are imported; fontsource splits per unicode-range so
// the browser fetches only the chunks that contain used glyphs.
import "@fontsource/shippori-mincho/latin-400.css";
import "@fontsource/shippori-mincho/latin-600.css";
import "@fontsource/shippori-mincho/latin-700.css";
import "@fontsource/shippori-mincho/japanese-400.css";
import "@fontsource/shippori-mincho/japanese-600.css";
import "@fontsource/shippori-mincho/japanese-700.css";
import "@fontsource/noto-sans-jp/latin-400.css";
import "@fontsource/noto-sans-jp/latin-600.css";
import "@fontsource/noto-sans-jp/japanese-400.css";
import "@fontsource/noto-sans-jp/japanese-600.css";
import "@fontsource/dotgothic16/latin-400.css";
import "@fontsource/dotgothic16/japanese-400.css";
import "./styles/global.css";
import "./styles/motion.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
