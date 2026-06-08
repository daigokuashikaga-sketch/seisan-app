// テスト用の環境変数（モジュール読み込み前に設定される setupFile）
process.env.DATABASE_URL = process.env.DATABASE_URL ?? ":memory:"
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "test-secret-key-test-secret-key"
process.env.WEBSITE_URL = process.env.WEBSITE_URL ?? "http://localhost:3000"
process.env.NODE_ENV = "test"
process.env.UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? `/tmp/seisan-test-uploads-${process.pid}`
