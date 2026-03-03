<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FoxSense One - メール通知テスト</title>
    <style>
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 30px;
        }
        .test-info {
            background-color: #f0f9ff;
            border-left: 4px solid #16a34a;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            margin: 10px 0;
            padding: 5px 0;
            border-bottom: 1px solid #e5e7eb;
        }
        .detail-label {
            font-weight: bold;
            color: #6b7280;
        }
        .detail-value {
            color: #111827;
            font-weight: 600;
        }
        .footer {
            background-color: #f8fafc;
            padding: 20px;
            text-align: center;
            color: #6b7280;
            font-size: 14px;
        }
        .success-message {
            background-color: #dcfce7;
            border: 1px solid #16a34a;
            color: #15803d;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
            text-align: center;
            font-weight: 600;
        }
        .emoji {
            font-size: 32px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="emoji">✅</div>
            <h1>FoxSense One - メール通知テスト</h1>
        </div>
        
        <div class="content">
            <p>{{ $user->name }}様</p>
            
            <div class="success-message">
                🎉 メール通知の設定が正常に完了しました！
            </div>
            
            <p>このメールは、FoxSense One温度監視システムの通知機能が正しく動作することを確認するためのテストメールです。</p>
            
            <div class="test-info">
                <div class="detail-row">
                    <span class="detail-label">登録ユーザー:</span>
                    <span class="detail-value">{{ $user->name }} ({{ $user->username }})</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">通知先メール:</span>
                    <span class="detail-value">{{ $email }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">登録日時:</span>
                    <span class="detail-value">{{ now()->format('Y年m月d日 H:i:s') }}</span>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                    <span class="detail-label">所有デバイス数:</span>
                    <span class="detail-value">{{ $user->devices()->count() }}台</span>
                </div>
            </div>

            <div style="background: #fffbeb; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #f59e0b;">
                <h4 style="margin-top: 0; color: #92400e;">通知について</h4>
                <ul style="color: #92400e; margin: 0; padding-left: 20px;">
                    <li>温度異常（高温警告・低温通知）が検知された際に、このメールアドレスに通知が送信されます</li>
                    <li>通知設定は各デバイスの詳細画面から個別に設定できます</li>
                    <li>重複通知を防ぐため、同じタイプの通知は1時間以内に1回のみ送信されます</li>
                    <li>通知が不要な場合は、メール管理画面から削除することができます</li>
                </ul>
            </div>
            
            <p>今後、登録されたデバイスで温度異常が検知された場合、このメールアドレスに通知が送信されます。</p>
            
            <p>このテストメールが正常に受信できていれば、通知機能の設定は完了です。</p>
        </div>
        
        <div class="footer">
            <p>このメールはFoxSense One温度監視システムから自動送信されています。</p>
            <p>設定変更については、<a href="{{ route('emails.index') }}" style="color: #16a34a;">メール管理画面</a>からお手続きください。</p>
            <p style="margin-top: 15px;">© 2025 geoAlpine LLC - FoxSense One Smart Agricultural Sensing</p>
        </div>
    </div>
</body>
</html>