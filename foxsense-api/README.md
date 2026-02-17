# FoxSense API

農業環境モニタリングシステムのバックエンドAPI

## クイックスタート

```bash
# 依存関係インストール
npm install

# データベース作成とシード
npx prisma db push
npm run db:seed

# 開発サーバー起動
npm run dev
```

サーバーは http://localhost:3001 で起動します。

## デモアカウント

| Email | Password | Role |
|-------|----------|------|
| admin@foxsense.jp | password123 | ADMIN |
| user@foxsense.jp | password123 | USER |

## APIエンドポイント

### 認証
- `POST /api/auth/register` - ユーザー登録
- `POST /api/auth/login` - ログイン
- `POST /api/auth/logout` - ログアウト
- `POST /api/auth/refresh` - トークン更新
- `GET /api/auth/me` - 現在のユーザー情報

### デバイス管理
- `GET /api/devices/parents` - 親機一覧
- `POST /api/devices/parents` - 親機登録
- `GET /api/devices/parents/:id` - 親機詳細
- `PUT /api/devices/parents/:id` - 親機更新
- `DELETE /api/devices/parents/:id` - 親機削除
- `GET /api/devices/parents/:parentId/children` - 子機一覧
- `POST /api/devices/parents/:parentId/children` - 子機登録
- `PUT /api/devices/children/:id` - 子機更新
- `DELETE /api/devices/children/:id` - 子機削除

### アラート設定
- `GET /api/devices/parents/:parentId/alerts` - アラート設定取得
- `PUT /api/devices/parents/:parentId/alerts` - アラート設定更新

### センサーデータ
- `GET /api/sensors/parents/:parentId/latest` - 最新データ
- `GET /api/sensors/devices/:deviceId/history` - 履歴データ
- `POST /api/sensors/callback` - Sigfoxコールバック（認証不要）

### 決済（Stripe）
- `POST /api/payments/create-checkout` - Checkout Session作成
- `GET /api/payments/subscription` - サブスクリプション情報
- `POST /api/payments/cancel` - サブスクリプションキャンセル
- `POST /api/payments/portal` - カスタマーポータル
- `POST /api/payments/webhook` - Stripe Webhook

### SORACOM
- `GET /api/soracom/sims` - SIM一覧
- `GET /api/soracom/sims/:simId` - SIM詳細
- `POST /api/soracom/sims/:simId/activate` - SIM有効化
- `POST /api/soracom/sims/:simId/suspend` - SIM一時停止
- `POST /api/soracom/sims/:simId/terminate` - SIM解約
- `GET /api/soracom/sims/:simId/usage` - 通信量

## 環境変数

`.env.example`を参照してください。

## 本番デプロイ

### Railway
```bash
# PostgreSQLアドオンを追加後
railway up
```

### Docker
```bash
docker-compose up -d
```
