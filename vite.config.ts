import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative base so the built site works from any folder or GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["vendor/*.js", "icons/*.png", "icons/*.svg"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,json,woff2}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: "Robot Lab",
        short_name: "Robot Lab",
        description: "Program a virtual robot with blocks or Python.",
        theme_color: "#0C0B0A",
        background_color: "#FDF9F2",
        display: "standalone",
        start_url: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  // Pre-bundle every CodeMirror package together so the dev server never ends up with
  // two copies of @codemirror/state after discovering a new import mid-load.
  optimizeDeps: {
    include: [
      "codemirror", "@codemirror/state", "@codemirror/view", "@codemirror/language",
      "@codemirror/commands", "@codemirror/autocomplete", "@codemirror/lang-python",
    ],
  },
  test: { environment: "node" },
});
