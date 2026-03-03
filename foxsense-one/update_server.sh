#!/bin/bash
echo "サーバーのファイルを更新します..."

# 権限変更
echo "zm2a-aok10" | sudo -S chown -R fox:fox /var/www/sav/foxsense-one/

# ファイル展開
cd /var/www/sav/foxsense-one
tar -xzf /tmp/foxsense-update.tar.gz

# Laravelキャッシュクリア
php artisan cache:clear
php artisan view:clear
php artisan config:clear

# 権限を戻す
echo "zm2a-aok10" | sudo -S chown -R www-data:www-data /var/www/sav/foxsense-one/

echo "更新完了"
