# リリース対応タスク

## 実装内容
1. [x] DBスキーマ設計 (users, expenses, settings)
2. [ ] Better Auth 認証 (email/password)
3. [ ] API routes (expenses CRUD, settings, users管理)
4. [ ] フロントエンド → API連携 (localStorageからDB移行)
5. [ ] ログイン画面リデザイン (招待コード制 or パスワード)
6. [ ] 月/年単位フィルター + 使用額グラフ (Dashboard改善)
7. [ ] OCR精度向上 (金額読み取り強化)
8. [ ] 管理者設定画面 (予算変更・メンバー管理)

## DB テーブル
- users: id, name, email, password, role, createdAt
- expenses: id, title, amount, date, category, submitterId, status, note, aiWarning, receiptImageKey, createdAt
- settings: id, key, value (budget等)

## API Routes
- POST /auth/* (Better Auth)
- GET/POST /expenses
- PATCH /expenses/:id (status変更)
- DELETE /expenses/:id
- GET /settings
- PATCH /settings
- GET /users (admin only)
- POST /users/invite
- DELETE /users/:id

## 注意
- authMiddleware を全APIに適用
- admin role チェックは requireAdmin ミドルウェアで
