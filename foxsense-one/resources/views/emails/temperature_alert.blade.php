<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FoxSense One - 温度異常アラート</title>
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
        .header.critical {
            background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
        }
        .header.warning {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
        }
        .content {
            padding: 30px;
        }
        .alert-info {
            background-color: #f8fafc;
            border-left: 4px solid #16a34a;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
        }
        .alert-info.critical {
            border-left-color: #dc2626;
            background-color: #fef2f2;
        }
        .alert-info.warning {
            border-left-color: #f59e0b;
            background-color: #fffbeb;
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
        .temperature {
            font-size: 1.5rem;
            font-weight: bold;
        }
        .temperature.high {
            color: #dc2626;
        }
        .temperature.low {
            color: #2563eb;
        }
        .footer {
            background-color: #f8fafc;
            padding: 20px;
            text-align: center;
            color: #6b7280;
            font-size: 14px;
        }
        .btn {
            display: inline-block;
            padding: 12px 24px;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin: 10px 0;
            box-shadow: 0 2px 4px rgba(5, 150, 105, 0.2);
        }
        .emoji {
            font-size: 32px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header {{ $alertType }}">
            <div class="emoji">
                @if($alertType === 'critical')
                    🔥
                @elseif($alertType === 'warning')
                    ❄️
                @else
                    🌡️
                @endif
            </div>
            <h1>FoxSense One - 温度異常アラート</h1>
        </div>
        
        <div class="content">
            <p>{{ $user->name }}様</p>
            
            <p>FoxSense Oneにより、設定された閾値を超える温度異常が検知されました。</p>
            
            <div class="alert-info {{ $alertType }}">
                <div class="detail-row">
                    <span class="detail-label">デバイス名:</span>
                    <span class="detail-value">{{ $device->device_name }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">設置場所:</span>
                    <span class="detail-value">{{ $device->location ?? '未設定' }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">検知温度:</span>
                    <span class="detail-value temperature {{ $temperature > 30 ? 'high' : 'low' }}">{{ $temperature }}°C</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">検知日時:</span>
                    <span class="detail-value">{{ $detectedAt->format('Y年m月d日 H:i:s') }}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Sigfox ID:</span>
                    <span class="detail-value">{{ $device->sigfox_device_id }}</span>
                </div>
            </div>

            <div style="background: #f0f9ff; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <h4 style="margin-top: 0; color: #1e40af;">設定された閾値</h4>
                <div class="detail-row" style="border-bottom: none;">
                    <span class="detail-label">低温通知閾値:</span>
                    <span class="detail-value">{{ $device->temp_notification_threshold ? $device->temp_notification_threshold . '°C以下' : '未設定' }}</span>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                    <span class="detail-label">高温警告閾値:</span>
                    <span class="detail-value">{{ $device->temp_alert_threshold ? $device->temp_alert_threshold . '°C以上' : '未設定' }}</span>
                </div>
            </div>
            
            @if($alertType === 'critical')
            <p style="color: #dc2626; font-weight: 600;">⚠️ 高温警告: 設定された高温警告閾値を超えています。早急な対応が必要です。</p>
            @elseif($alertType === 'warning')
            <p style="color: #f59e0b; font-weight: 600;">⚠️ 低温通知: 設定された低温通知閾値を下回っています。ご確認ください。</p>
            @endif
            
            <p>必要に応じて現地の確認をお願いいたします。</p>
            
            <p><a href="{{ route('devices.detail', $device->id) }}" class="btn">デバイス詳細を確認</a></p>
        </div>
        
        <div class="footer">
            <p>このメールはFoxSense One温度監視システムから自動送信されています。</p>
            <p>設定変更や通知停止については、<a href="{{ route('devices.detail', $device->id) }}" style="color: #16a34a;">デバイス設定画面</a>からお手続きください。</p>
            <p style="margin-top: 15px;">© 2025 geoAlpine LLC - FoxSense One Smart Agricultural Sensing</p>
        </div>
    </div>
</body>
</html>