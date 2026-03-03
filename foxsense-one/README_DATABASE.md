# FoxSense One データベース設定ガイド

## 対応データベース

FoxSense One は以下のデータベースに対応しています：

- **SQLite** (開発環境・小規模運用向け)
- **MySQL 5.7+** / **MariaDB 10.3+** (本番環境向け)

## 1. SQLite 設定（デフォルト）

### 特徴
- 設定が簡単、追加のデータベースサーバー不要
- 50台以下のデバイス運用に最適
- ファイルベースで管理が容易

### 設定方法
`.env`ファイルで以下を設定：

```env
DB_CONNECTION=sqlite
# DB_DATABASE=database/database.sqlite (デフォルト)
```

### 初期設定
```bash
# データベースファイルの作成
touch database/database.sqlite

# マイグレーション実行
php artisan migrate
```

## 2. MySQL/MariaDB 設定

### 特徴
- 大規模運用に対応（100台以上のデバイス）
- 高パフォーマンス、同時アクセス対応
- レプリケーション・バックアップが容易

### 必要条件
- MySQL 5.7 以上 または MariaDB 10.3 以上
- UTF8MB4 文字セット対応

### 設定方法

#### 2.1 データベース作成
```sql
CREATE DATABASE foxsense_one CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'foxsense'@'localhost' IDENTIFIED BY 'your-secure-password';
GRANT ALL PRIVILEGES ON foxsense_one.* TO 'foxsense'@'localhost';
FLUSH PRIVILEGES;
```

#### 2.2 環境設定
`.env`ファイルを編集：

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=foxsense_one
DB_USERNAME=foxsense
DB_PASSWORD=your-secure-password
```

#### 2.3 マイグレーション実行
```bash
php artisan migrate
```

## 3. データベース切り替え手順

### SQLite から MySQL への移行

1. **データのエクスポート**
```bash
# CSVエクスポート機能を使用してデータをバックアップ
php artisan tinker
>>> \DB::table('devices')->get()->toJson();
>>> \DB::table('temperature_data')->get()->toJson();
```

2. **MySQL設定に変更**
`.env`ファイルを編集してMySQL設定に変更

3. **マイグレーション実行**
```bash
php artisan migrate:fresh
```

4. **データのインポート**
```bash
php artisan tinker
# エクスポートしたJSONデータをインポート
```

## 4. パフォーマンス最適化

### SQLite の場合
```sql
-- database/database.sqlite で実行
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

### MySQL の場合
```sql
-- my.cnf または my.ini に追加
[mysqld]
innodb_buffer_pool_size = 256M
innodb_log_file_size = 64M
max_connections = 100
```

## 5. インデックス最適化

両データベースで共通のインデックスが自動作成されます：

- `devices` テーブル
  - `sigfox_device_id` (UNIQUE)
  - `user_id`
  - `last_seen`

- `temperature_data` テーブル
  - `device_id, sigfox_time` (UNIQUE)
  - `created_at`
  - `temperature`

## 6. バックアップ

### SQLite
```bash
# バックアップ
cp database/database.sqlite database/backup/database_$(date +%Y%m%d).sqlite

# リストア
cp database/backup/database_20250827.sqlite database/database.sqlite
```

### MySQL
```bash
# バックアップ
mysqldump -u foxsense -p foxsense_one > backup/foxsense_one_$(date +%Y%m%d).sql

# リストア
mysql -u foxsense -p foxsense_one < backup/foxsense_one_20250827.sql
```

## 7. トラブルシューティング

### エラー: SQLSTATE[HY000] [2002] Connection refused
- MySQLサーバーが起動していることを確認
- ポート番号が正しいか確認（デフォルト: 3306）

### エラー: SQLSTATE[HY000] [1045] Access denied
- ユーザー名とパスワードを確認
- ユーザーの権限を確認

### エラー: Syntax error or access violation
- MySQLのバージョンを確認（5.7以上必要）
- 文字セットがutf8mb4であることを確認

## 8. 推奨構成

| デバイス数 | 推奨DB | 理由 |
|-----------|--------|------|
| 1-50台 | SQLite | シンプル、メンテナンス不要 |
| 51-200台 | MySQL | パフォーマンス、同時アクセス |
| 200台以上 | MySQL + Redis | 高速キャッシュ、スケーラビリティ |

## 9. 監視項目

### SQLite
- ファイルサイズ（推奨: 1GB以下）
- ディスク空き容量

### MySQL
- 接続数（max_connections）
- スロークエリログ
- ディスク使用率

## サポート

問題が発生した場合は、以下を確認してください：
1. Laravelログ: `storage/logs/laravel.log`
2. データベース接続テスト: `php artisan db:show`
3. マイグレーション状態: `php artisan migrate:status`