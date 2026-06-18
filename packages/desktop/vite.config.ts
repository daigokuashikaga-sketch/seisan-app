import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";

// ネイティブ依存（libSQL）は main バンドルに取り込まず、実行時に
// node_modules から解決させる。それ以外（hono/drizzle/better-auth 等）は
// main.js にバンドルする。
const nativeExternals = ["@libsql/client", "libsql"];

export default defineConfig({
  build: {
    rollupOptions: {
      input: path.join(__dirname, "electron/no-renderer.ts"),
    },
  },
  plugins: [
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: nativeExternals,
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
});
