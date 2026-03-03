<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FoxSense One - 圃場センシングシステム</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 3rem;
            border-radius: 20px;
            border: 2px solid #dcfce7;
            box-shadow: 0 10px 25px rgba(34, 197, 94, 0.1);
            text-align: center;
            max-width: 700px;
            width: 90%;
        }
        .logo {
            font-size: 3rem;
            font-weight: bold;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 1rem;
        }
        .tagline {
            font-size: 1.1rem;
            color: #374151;
            margin-bottom: 3rem;
            line-height: 1.6;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 2rem;
            margin: 3rem 0;
        }
        .feature {
            text-align: center;
        }
        .feature-icon {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }
        .feature-title {
            font-weight: 600;
            color: #059669;
            margin-bottom: 0.25rem;
        }
        .feature-desc {
            font-size: 0.875rem;
            color: #6b7280;
        }
        .btn {
            display: inline-block;
            padding: 1rem 3rem;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            font-weight: 600;
            font-size: 1.1rem;
            margin: 0.5rem;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(5, 150, 105, 0.2);
        }
        .btn:hover {
            background: linear-gradient(135deg, #15803d 0%, #047857 100%);
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(5, 150, 105, 0.3);
        }
        .footer {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e5e7eb;
            font-size: 0.875rem;
            color: #6b7280;
        }
        @media (max-width: 640px) {
            .features {
                grid-template-columns: 1fr;
                gap: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🌿 FoxSense One</div>
        <div class="tagline">
            圃場の"いま"を測る<br>
            – FoxSense ONEで始めるスマートセンシング –
        </div>
        
        <div class="features">
            <div class="feature">
                <div class="feature-icon">🌡️</div>
                <div class="feature-title">温度監視</div>
                <div class="feature-desc">24時間365日<br>リアルタイム監視</div>
            </div>
            <div class="feature">
                <div class="feature-icon">📡</div>
                <div class="feature-title">Sigfox通信</div>
                <div class="feature-desc">省電力・広域<br>安定した通信</div>
            </div>
            <div class="feature">
                <div class="feature-icon">📊</div>
                <div class="feature-title">データ分析</div>
                <div class="feature-desc">統計・グラフ<br>CSV出力対応</div>
            </div>
        </div>

        <div style="margin-top: 3rem;">
            @auth
                <a href="{{ route('dashboard') }}" class="btn">ダッシュボードへ</a>
            @else
                <a href="{{ route('login') }}" class="btn">ログイン</a>
                <a href="{{ route('register') }}" class="btn" style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); color: #374151;">新規登録</a>
            @endauth
        </div>

        <div class="footer">
            <p>Powered by Laravel 12 | PHP 8.3 | Sigfox API</p>
            <p style="margin-top: 0.5rem;">© 2025 geoAlpine LLC - FoxSense One Smart Agricultural Sensing</p>
        </div>
    </div>
</body>
</html>