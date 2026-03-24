#!/bin/bash
# VPS へ foxsense-satellite をデプロイするスクリプト
# 実行: bash deploy.sh

set -e

VPS="fox@210.131.217.236"
KEY="~/.ssh/id_ed25519_vps"
REMOTE_DIR="/home/fox/foxsense-satellite"

echo "=== 1. ファイル転送 ==="
rsync -r --exclude '__pycache__' --exclude '*.pyc' --exclude 'venv' \
  -e "ssh -i $KEY" \
  "$(dirname "$0")/" "$VPS:$REMOTE_DIR/"

echo "=== 2. Python 環境セットアップ ==="
ssh -i "$KEY" "$VPS" bash << 'ENDSSH'
cd ~/foxsense-satellite
python3 -m venv venv 2>/dev/null || true
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
ENDSSH

echo "=== 3. PM2 登録/再起動 ==="
ssh -i "$KEY" "$VPS" bash << 'ENDSSH'
cd ~/foxsense-satellite
source venv/bin/activate
if pm2 list | grep -q foxsense-satellite; then
  pm2 restart foxsense-satellite
else
  pm2 start "venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2" \
    --name foxsense-satellite
fi
pm2 save
ENDSSH

echo "=== 4. nginx 設定確認 ==="
ssh -i "$KEY" "$VPS" bash << 'ENDSSH'
CONF="/etc/nginx/sites-available/foxsense"
if ! grep -q "satellite" "$CONF" 2>/dev/null; then
  echo ""
  echo "⚠️  nginx に /satellite ルートを追加してください:"
  echo ""
  echo "  location /satellite/ {"
  echo "    proxy_pass http://127.0.0.1:8000/;"
  echo "    proxy_read_timeout 120s;"
  echo "    proxy_set_header Host \$host;"
  echo "  }"
  echo ""
fi
ENDSSH

echo "=== done ==="
echo "VITE_SATELLITE_API_URL=https://foxsense.smart-agri-vision.net/satellite をビルド時に設定してください"
