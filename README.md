# 精算管理システム (seisan-app)

小規模チーム向けの経費精算アプリ。領収書をOCRで読み取って申請し、管理者が承認/却下、ダッシュボードで予算消化を可視化します。

Monorepo: Bun workspaces + Turborepo。メインは `packages/web`（API + フロントを単一サーバで配信）。

## 主な機能

- **経費申請**: 領収書画像のアップロード＋OCR自動入力（金額・日付・件名）、カテゴリ/備考
- **申請履歴**: 年月/ステータス/検索フィルタ、CSVエクスポート、二重申請のAI警告
- **承認フロー**: 管理者による承認/却下（却下理由付き）、領収書画像の閲覧
- **ダッシュボード**: 予算消化バー、カテゴリ別・月別の集計グラフ
- **管理機能**: 月次予算設定、ユーザーのロール管理、メンバー招待
- **認証/招待制**: メール＋パスワード認証。最初の登録者が管理者になり、以降は招待制

## 技術スタック

| レイヤ | 技術 |
|---|---|
| フロント | React 19 / Wouter / TanStack Query / Tailwind 4 / Tesseract.js(OCR) |
| API | Hono (Bun) |
| 認証 | Better-Auth（メール/パスワード、セッションCookie、ロール) |
| DB | Drizzle ORM + Turso (libSQL) |
| テスト/CI | Vitest / ESLint / GitHub Actions |

## セットアップ

```sh
bun install
cp .env.template .env   # 値を埋める（下記参照）
cd packages/web && bun run db:push   # スキーマをDBへ反映
```

### 環境変数 (`.env`)

| 変数 | 説明 |
|---|---|
| `DATABASE_URL` / `DATABASE_AUTH_TOKEN` | Turso の接続情報 |
| `BETTER_AUTH_SECRET` | セッション署名用のランダムな秘密鍵 |
| `WEBSITE_URL` | アプリの公開URL（例 `http://localhost:3000`） |
| `ALLOWED_ORIGINS` | CORS許可オリジン（カンマ区切り）。**本番では必ず設定** |
| `UPLOAD_DIR` | 領収書画像の保存先（既定 `./uploads`） |

シークレットは `.env`（gitignore対象）に置きます。Vite の `loadEnv` が dev/build 時に `process.env` へ読み込みます。

## 開発

```sh
bun run dev          # web 開発サーバ
bun run typecheck    # 型チェック (tsc -b)
bun run lint         # ESLint
bun run test         # Vitest（APIルート/バリデーション/認可/領収書/招待）
bun run build        # 本番ビルド
```

データベース操作:

```sh
cd packages/web
bun run db:push        # スキーマをDBへ反映（差分適用）
bun run db:generate    # マイグレーション生成
bun run db:migrate     # マイグレーション適用
bun run db:studio      # Drizzle Studio
```

## 本番デプロイ

### Docker

```sh
docker build -t seisan-app .
docker run -p 3000:3000 --env-file .env -v $(pwd)/uploads:/app/uploads seisan-app
```

`uploads/` は領収書画像の保存先なので、永続ボリュームをマウントしてください。

### PM2

```sh
bun run build:web
bun run start   # ecosystem.config.cjs で起動
```

## 認証・招待フロー

1. **最初の登録者**は自動的に管理者になります（招待コード不要）。
2. 以降の登録は**招待制**。管理者が「管理 > メンバー招待」でメールとロールを指定して招待リンクを発行します。
3. 招待リンク (`/?invite=CODE`) から開くと招待コードが自動補完され、登録できます。
4. 有効な招待がない登録はサーバ側で拒否されます。

## Windows デスクトップアプリ（Electron / スタンドアロン）

`packages/desktop` は **サーバー不要のスタンドアロンアプリ** です。`.exe` を起動するだけで動きます。

- Electron の main プロセス内に Hono API サーバーを埋め込み、`127.0.0.1` で起動します。
- データはその PC 内の **ローカル SQLite**（libSQL）に保存（`userData/seisan.db`）。領収書画像も `userData/uploads` に保存。
- 初回起動時に DB マイグレーションを自動実行。最初に作成したアカウントが**管理者**になり、以降は管理者が発行した招待でメンバーを追加できます（社内複数ユーザー対応）。
- 外部ネットワーク・別途サーバーのデプロイは不要。オフラインで利用できます。

### 起動後の流れ（利用者向け）

1. `.exe`（または `Seisan-Windows-x.y.z-Setup.exe`）でインストール・起動。
2. 最初のユーザーがアカウント作成 → 自動で管理者に。
3. 管理者が「メンバー管理」から招待を発行し、同じ PC で各メンバーがログイン。

### 開発（ローカルで確認）

```sh
# 1) web フロントをビルド（Electron はビルド済み静的ファイルを配信）
cd packages/desktop && bun run build:web && bun run prepare:assets
# 2) Electron を起動（埋め込みサーバーが起動し localhost:47823 を表示）
bun run dev
```

### Windows インストーラ(.exe)のビルド

- **CI（推奨）**: GitHub Actions の「Desktop (Windows)」ワークフローが、手動実行（`workflow_dispatch`）/ `desktop-v*` タグ / `claude/**` ブランチへの push でトリガーされ、`windows-latest` で未署名インストーラをビルドし、成果物 `seisan-windows-installer` としてアップロードします。
- **Windows ローカル**:
  ```sh
  cd packages/desktop
  bun run dist        # web ビルド + 同梱 + electron-builder（release/ に Seisan-Windows-*-Setup.exe）
  ```

> 配布物は完全に自己完結しており、起動だけで利用できます。データは各 PC ローカルに保存されるため、PC 間でのデータ共有は行いません。

## ディレクトリ構成

```
packages/web/
  src/
    api/                 Hono API
      routes/            expenses / users / settings / invitations
      validation/        zod スキーマ + パースヘルパー
      lib/               storage（領収書保存）/ origins（CORS許可）
      middleware/        認証ガード (requireAuth / requireAdmin)
      database/          Drizzle スキーマ & クライアント
      auth.ts            Better-Auth 設定 + 招待ゲート
      __tests__/         Vitest（インメモリ libsql）
    web/                 React フロント
      pages/index.tsx    画面（申請/履歴/ダッシュボード/管理）
      components/        UI / ErrorBoundary
      lib/               api（型付きクライアント）/ auth / receiptOcr
    shared/constants.ts  フロント・バック共有の定数/enum
  drizzle/               マイグレーション
packages/desktop/        Electron（埋め込みサーバー + ローカルSQLite のスタンドアロン）
  electron/
    main.ts              ウィンドウ/ライフサイクル/サーバー起動
    server/start-server  Hono API + 静的配信 + マイグレーションの埋め込み起動
    preload.ts           contextBridge（dialog/fs/notification/window）
packages/mobile/         Expo アプリ
```
