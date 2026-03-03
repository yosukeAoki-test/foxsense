<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ログイン - FoxSense One</title>
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
            max-width: 400px;
            width: 90%;
        }
        .logo {
            font-size: 2rem;
            font-weight: bold;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 2rem;
            text-align: center;
        }
        .form-group {
            margin-bottom: 1.5rem;
        }
        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #374151;
        }
        input[type="text"], input[type="email"], input[type="password"] {
            width: 100%;
            padding: 1rem;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 1rem;
            transition: border-color 0.3s ease;
        }
        input:focus {
            outline: none;
            border-color: #16a34a;
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
        }
        .btn {
            width: 100%;
            padding: 1rem;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(5, 150, 105, 0.2);
        }
        .btn:hover {
            background: linear-gradient(135deg, #15803d 0%, #047857 100%);
            transform: translateY(-1px);
            box-shadow: 0 6px 10px rgba(5, 150, 105, 0.3);
        }
        .link {
            display: block;
            text-align: center;
            margin-top: 1rem;
            color: #059669;
            text-decoration: none;
            font-weight: 500;
        }
        .link:hover {
            text-decoration: underline;
        }
        .error {
            color: #dc2626;
            font-size: 0.875rem;
            margin-top: 0.5rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🌿 FoxSense One</div>
        
        <form method="POST" action="{{ route('login') }}">
            @csrf
            
            <div class="form-group">
                <label for="email">メールアドレス</label>
                <input id="email" type="email" name="email" value="{{ old('email') }}" required autofocus>
                @error('email')
                    <div class="error">{{ $message }}</div>
                @enderror
            </div>

            <div class="form-group">
                <label for="password">パスワード</label>
                <input id="password" type="password" name="password" required>
                @error('password')
                    <div class="error">{{ $message }}</div>
                @enderror
            </div>

            <button type="submit" class="btn">ログイン</button>
        </form>

        <a href="{{ route('register') }}" class="link">新規登録はこちら</a>
        <a href="{{ url('/') }}" class="link">ホームに戻る</a>
        
        <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; text-align: center; font-size: 0.75rem; color: #9ca3af;">
            © 2025 geoAlpine LLC - FoxSense One Smart Agricultural Sensing
        </div>
    </div>
</body>
</html>