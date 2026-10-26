import { writeFileSync } from "node:fs";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

// Go embeds web/dist, so the directory must exist even before the first build.
// The tracked placeholder is recreated after Vite empties the folder.
const keepDistInGit: Plugin = {
  name: "keep-dist-in-git",
  closeBundle() {
    writeFileSync("web/dist/.gitkeep", "");
  },
};

// The Go server embeds web/dist. During `npm run dev`, Vite proxies the API and the
// realtime channel to a Go server started with `go run ./cmd/linkdrop`.
export default defineConfig({
  root: "web",
  plugins: [preact(), keepDistInGit],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: {
    proxy: { "/api": { target: "http://localhost:3000", ws: true } },
  },
});
