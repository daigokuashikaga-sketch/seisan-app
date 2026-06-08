# seisan-app 本番イメージ（Bun ランタイム）
FROM oven/bun:1.3.5

WORKDIR /app

# 依存インストール（lockfile 固定）
COPY package.json bun.lock ./
COPY packages/web/package.json packages/web/package.json
COPY packages/desktop/package.json packages/desktop/package.json
COPY packages/mobile/package.json packages/mobile/package.json
RUN bun install --frozen-lockfile

# ソースをコピーしてビルド
COPY . .
RUN cd packages/web && bun run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 領収書画像は永続ボリュームに保存する
VOLUME ["/app/uploads"]

CMD ["bun", "packages/web/src/server.ts"]
