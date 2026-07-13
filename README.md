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
5. オフライン版で「最初の管理者」からやり直したいときは、メニュー「**データを初期化（リセット）…**」で全データを消去できます（登録者0人に戻るため、次に登録した人が再び管理者になります）。

## Windows デスクトップアプリ（Electron / デュアルモード）

`packages/desktop` は `.exe` を起動するだけで動くデスクトップアプリです。初回起動時に**利用方法を選択**できます（メニュー「動作モードを変更…」でいつでも切替可）。

### ダウンロード（Windows・すぐ使う）

ビルド不要。**[Releases](https://github.com/daigokuashikaga-sketch/seisan-app/releases/latest) から `Seisan-Windows-*-Setup.exe` をダウンロード**して実行するだけです（ログイン不要・誰でも取得可）。

- 最新版: **v0.3.0** — [ダウンロードページ](https://github.com/daigokuashikaga-sketch/seisan-app/releases/tag/desktop-v0.3.0) ／ [インストーラ直リンク](https://github.com/daigokuashikaga-sketch/seisan-app/releases/download/desktop-v0.3.0/Seisan-Windows-0.3.0-Setup.exe)
- ⚠️ 未署名アプリのため、初回起動時に「**WindowsによってPCが保護されました**」の青い警告が出たら **「詳細情報」→「実行」** で起動できます（動作に問題はありません）。

| モード | データの保存先 | 用途 |
|---|---|---|
| 💻 **オフライン**（この PC だけで使う）| PC 内のローカル SQLite（`userData/seisan.db`）| 個人・1台運用。サーバー不要・ネット不要 |
| 🌐 **オンライン**（共有サーバーに接続）| 接続先サーバーの DB | 複数 PC・複数メンバーでデータ共有 |

**オフラインモード**は Electron の main プロセス内に Hono API サーバーを埋め込み `127.0.0.1` で起動します。初回起動時に DB マイグレーションを自動実行。領収書画像も `userData/uploads` に保存され、メニュー「**データをバックアップ…**」で DB＋画像の整合スナップショット（`VACUUM INTO`）を任意のフォルダに書き出せます。メニュー「**データを初期化（リセット）…**」を選ぶと、確認後にアプリを再起動して DB・領収書をすべて削除し初期状態に戻せます（使用中の DB ファイルがロックされる問題を避けるため、削除は再起動直後の新プロセスで実行）。

**オンラインモード**は下記「オンライン運用（共有サーバー）」でデプロイしたサーバーの URL を入力して接続します。接続前にヘルスチェックで URL を検証します。企業配布では環境変数 `SEISAN_SERVER_URL` で接続先を固定でき、設定画面をスキップできます。

どちらのモードでも: 最初に作成したアカウントが**管理者**になり、以降は管理者が発行した招待でメンバーを追加します（招待制）。

### セキュリティ対策（v0.2.0）

- **認証レート制限**: `POST /api/auth/*` はクライアントあたり 20回/分（ブルートフォース対策、429 + Retry-After）
- **セキュリティヘッダ**: API・静的配信の両方に `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` 等を付与
- **リクエストサイズ上限**: 8MB（領収書5MB＋multipartオーバーヘッド）
- **Electron 側**: レンダラーの `sandbox` 有効化、`contextIsolation`、アプリのオリジン以外へのナビゲーション遮断（外部リンクは既定ブラウザで開く）、`window.open` 拒否
- **認証**: パスワード最小8文字、ロールはサーバー側でのみ付与（クライアントから昇格不可）、セッションは HttpOnly Cookie
- 既存: zod による全ミューテーション検証、認可ガード（最後の管理者保護等）、CORS/trustedOrigins の許可リスト化、領収書のMIME/サイズ検証とパストラバーサル防止

### 起動後の流れ（利用者向け）

1. `Seisan-Windows-x.y.z-Setup.exe` でインストール・起動。
2. モードを選択（オフライン ＝ すぐ使える／オンライン ＝ 管理者から共有されたサーバーURLを入力）。
3. 最初のユーザーがアカウント作成 → 自動で管理者に。
4. 管理者が「管理」タブから招待を発行し、メンバーを追加。

### オンライン運用（共有サーバーのデプロイ）

複数 PC でデータを共有する場合は、`packages/web` をサーバーにデプロイします。Docker が最も簡単です:

```sh
docker build -t seisan .
docker run -d --name seisan -p 3000:3000 \
  -e WEBSITE_URL=https://seisan.example.com \
  -e ALLOWED_ORIGINS=https://seisan.example.com \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL=file:/data/seisan.db \
  -v seisan-data:/data -v seisan-uploads:/app/uploads \
  seisan
```

- `DATABASE_URL` はローカルファイル（`file:` + 永続ボリューム）のほか、Turso（`libsql://...` + `DATABASE_AUTH_TOKEN`）も利用可能。
- **本番では必ず HTTPS で公開**してください（リバースプロキシ / TLS 終端）。Cookie 保護・盗聴防止のため必須です。
- レート制限はプロキシの `X-Forwarded-For` を参照します。プロキシで正しく設定してください。
- デプロイ後、デスクトップアプリの「共有サーバーに接続」にその URL を入力すれば接続できます（ブラウザから直接同じ URL を開いても利用可能）。

### 開発（ローカルで確認）

```sh
# 1) web フロントをビルド（Electron はビルド済み静的ファイルを配信）
cd packages/desktop && bun run build:web && bun run prepare:assets
# 2) Electron を起動（モード選択画面が表示される）
bun run dev
```

### Windows インストーラ(.exe)のビルド

- **CI（推奨）**: GitHub Actions の「Desktop (Windows)」ワークフローが、手動実行（`workflow_dispatch`）/ `desktop-v*` タグ / `claude/**` ブランチへの push でトリガーされ、`windows-latest` で未署名インストーラをビルドし、成果物アップロード＋ GitHub Release への公開を行います。
- **Windows ローカル**:
  ```sh
  cd packages/desktop
  bun run dist        # web ビルド + 同梱 + electron-builder（release/ に Seisan-Windows-*-Setup.exe）
  ```

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
packages/desktop/        Electron（オフライン=埋め込みサーバー / オンライン=共有サーバー接続）
  electron/
    main.ts              ウィンドウ/ライフサイクル/モード選択/サーバー起動
    server/start-server  Hono API + 静的配信 + マイグレーションの埋め込み起動
    server/backup.ts     DB整合スナップショット(VACUUM INTO) + 領収書のバックアップ
    preload.ts           contextBridge（モード設定/バックアップ/dialog/notification/window）
packages/mobile/         Expo アプリ
```
