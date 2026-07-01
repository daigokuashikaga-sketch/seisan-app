import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";

// ネイティブモジュール(libSQL本体)だけは main バンドルに取り込まず、実行時に
// node_modules から解決させる。@libsql/client などの JS 依存は main.js にバンドルする
// （electron-builder が bun の推移的依存を収集できない問題を回避するため）。
const nativeExternals = ["libsql"];

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
