<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FoxSense One バッテリー低下通知</title>
    <style>
        body {
            font-family: 'Noto Sans JP', sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            background: {{ $alertType === 'battery_critical' ? '#dc3545' : '#ffc107' }};
            color: {{ $alertType === 'battery_critical' ? '#ffffff' : '#212529' }};
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: bold;
        }
        .content {
            padding: 30px;
            background-color: #ffffff;
        }
        .alert-box {
            background-color: {{ $alertType === 'battery_critical' ? '#f8d7da' : '#fff3cd' }};
            border: 1px solid {{ $alertType === 'battery_critical' ? '#f5c6cb' : '#ffeeba' }};
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
        }
        .alert-title {
            font-size: 18px;
            font-weight: bold;
            color: {{ $alertType === 'battery_critical' ? '#721c24' : '#856404' }};
            margin-bottom: 10px;
        }
        .data-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }
        .data-item {
            background-color: #f8f9fa;
            padding: 12px;
            border-radius: 6px;
        }
        .data-label {
            color: #6c757d;
            font-size: 12px;
            margin-bottom: 4px;
        }
        .data-value {
            color: #212529;
            font-size: 18px;
            font-weight: bold;
        }
        .battery-status {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 20px 0;
        }
        .battery-icon {
            width: 150px;
            height: 60px;
            border: 3px solid #333;
            border-radius: 6px;
            position: relative;
            margin-right: 20px;
        }
        .battery-icon::after {
            content: '';
            position: absolute;
            right: -8px;
            top: 50%;
            transform: translateY(-50%);
            width: 6px;
            height: 20px;
            background-color: #333;
            border-radius: 0 2px 2px 0;
        }
        .battery-fill {
            height: 100%;
            border-radius: 3px;
            background-color: {{ $batteryLevel <= 10 ? '#dc3545' : ($batteryLevel <= 20 ? '#ffc107' : '#28a745') }};
            width: {{ $batteryLevel }}%;
            transition: width 0.3s;
        }
        .battery-text {
            font-size: 32px;
            font-weight: bold;
            color: {{ $batteryLevel <= 10 ? '#dc3545' : ($batteryLevel <= 20 ? '#ffc107' : '#28a745') }};
        }
        .message {
            background-color: #e9ecef;
            border-left: 4px solid {{ $alertType === 'battery_critical' ? '#dc3545' : '#ffc107' }};
            padding: 15px;
            margin: 20px 0;
        }
        .footer {
            background-color: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #6c757d;
            font-size: 14px;
        }
        .button {
            display: inline-block;
            padding: 12px 30px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            margin-top: 15px;
            font-weight: bold;
        }
        .button:hover {
            background-color: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔋 FoxSense One バッテリー{{ $alertType === 'battery_critical' ? '切れ警告' : '低下通知' }}</h1>
        </div>
        
        <div class="content">
            <p>{{ $user->name }} 様</p>
            
            <div class="alert-box">
                <div class="alert-title">
                    ⚠️ {{ $alertType === 'battery_critical' ? '緊急：バッテリー切れ警告' : 'バッテリー低下通知' }}
                </div>
                <p><strong>{{ $device->device_name }}</strong> のバッテリーが低下しています。</p>
            </div>
            
            <div class="battery-status">
                <div class="battery-icon">
                    <div class="battery-fill"></div>
                </div>
                <div class="battery-text">{{ $batteryLevel ?? 0 }}%</div>
            </div>
            
            <div class="data-grid">
                <div class="data-item">
                    <div class="data-label">デバイス名</div>
                    <div class="data-value">{{ $device->device_name }}</div>
                </div>
                <div class="data-item">
                    <div class="data-label">デバイスID</div>
                    <div class="data-value">{{ $device->sigfox_device_id }}</div>
                </div>
                <div class="data-item">
                    <div class="data-label">バッテリー電圧</div>
                    <div class="data-value">{{ number_format($batteryVoltage ?? 0, 2) }} V</div>
                </div>
                <div class="data-item">
                    <div class="data-label">バッテリーレベル</div>
                    <div class="data-value">{{ $batteryLevel ?? 0 }} %</div>
                </div>
                <div class="data-item">
                    <div class="data-label">現在の温度</div>
                    <div class="data-value">{{ number_format($temperature ?? 0, 1) }} °C</div>
                </div>
                <div class="data-item">
                    <div class="data-label">検知日時</div>
                    <div class="data-value">{{ $detectedAt->format('m/d H:i') }}</div>
                </div>
            </div>
            
            <div class="message">
                <strong>📌 対応のお願い</strong>
                <p>{{ $message }}</p>
                @if($alertType === 'battery_critical')
                <p style="color: #dc3545; font-weight: bold;">
                    ニッケル水素電池の放電終止電圧（1.0V/本）に達しています。<br>
                    このまま放電を続けると電池が劣化し、使用できなくなる恐れがあります。
                </p>
                @endif
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="{{ url('/dashboard') }}" class="button">ダッシュボードで確認</a>
            </div>
        </div>
        
        <div class="footer">
            <p>このメールは FoxSense One システムから自動送信されています。</p>
            <p>© 2025 FoxSense One - 圃場センシングシステム</p>
        </div>
    </div>
</body>
</html>