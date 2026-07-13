// パッケージング前準備:
// packages/web のビルド出力（dist）と drizzle マイグレーションを
// desktop パッケージ配下へコピーし、electron-builder で app.asar に同梱できるようにする。
import { cp, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const webRoot = path.resolve(desktopRoot, "../web");

const targets = [
  { from: path.join(webRoot, "dist"), to: path.join(desktopRoot, "web-dist") },
  { from: path.join(webRoot, "drizzle"), to: path.join(desktopRoot, "drizzle") },
];

for (const { from, to } of targets) {
  try {
    await access(from);
  } catch {
    console.error(
      `[prepare-assets] 入力が見つかりません: ${from}\n  先に packages/web をビルドしてください（bun run build:web）。`,
    );
    process.exit(1);
  }
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`[prepare-assets] copied ${path.relative(desktopRoot, from)} -> ${path.relative(desktopRoot, to)}`);
}
