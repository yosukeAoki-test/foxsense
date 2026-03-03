<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'FoxSense One')</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            color: #374151;
        }
        
        /* ヘッダー */
        .header {
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            padding: 1rem 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            text-decoration: none;
            color: white;
        }
        .nav {
            display: flex;
            gap: 1rem;
        }
        .nav a {
            color: white;
            text-decoration: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            transition: background 0.3s;
        }
        .nav a:hover {
            background: rgba(255,255,255,0.1);
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        /* メインコンテンツ */
        .main {
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        .card {
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            margin-bottom: 2rem;
        }
        .card-header {
            padding: 1.5rem;
            border-bottom: 1px solid #e5e7eb;
            font-weight: 600;
            font-size: 1.125rem;
        }
        .card-body {
            padding: 1.5rem;
        }
        
        /* ボタン */
        .btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
            color: white;
            text-decoration: none;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            margin: 0.25rem;
            box-shadow: 0 2px 4px rgba(5, 150, 105, 0.2);
        }
        .btn:hover {
            background: linear-gradient(135deg, #15803d 0%, #047857 100%);
            transform: translateY(-1px);
            box-shadow: 0 3px 6px rgba(5, 150, 105, 0.3);
        }
        .btn-danger {
            background: #dc2626;
        }
        .btn-danger:hover {
            background: #b91c1c;
        }
        .btn-success {
            background: #059669;
        }
        .btn-success:hover {
            background: #047857;
        }
        
        /* フォーム */
        .form-group {
            margin-bottom: 1.5rem;
        }
        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
        }
        .form-control {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 1rem;
        }
        .form-control:focus {
            outline: none;
            border-color: #16a34a;
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
        }
        
        /* テーブル */
        .table {
            width: 100%;
            border-collapse: collapse;
        }
        .table th,
        .table td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        .table th {
            background: #f9fafb;
            font-weight: 600;
        }
        
        /* アラート */
        .alert {
            padding: 1rem;
            border-radius: 6px;
            margin-bottom: 1rem;
        }
        .alert-success {
            background: #d1fae5;
            border: 1px solid #10b981;
            color: #065f46;
        }
        .alert-error {
            background: #fee2e2;
            border: 1px solid #ef4444;
            color: #991b1b;
        }
        
        /* ステータス */
        .status {
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        .status-online {
            background: #d1fae5;
            color: #065f46;
        }
        .status-offline {
            background: #fee2e2;
            color: #991b1b;
        }
        
        /* グリッド */
        .grid {
            display: grid;
            gap: 1rem;
        }
        .grid-2 {
            grid-template-columns: repeat(2, 1fr);
        }
        .grid-3 {
            grid-template-columns: repeat(3, 1fr);
        }
        .grid-4 {
            grid-template-columns: repeat(4, 1fr);
        }
        
        @media (max-width: 768px) {
            .grid-2, .grid-3, .grid-4 {
                grid-template-columns: 1fr;
            }
            .nav {
                flex-direction: column;
                gap: 0.5rem;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="container">
            <a href="{{ route('dashboard') }}" class="logo">🌿 FoxSense One</a>
            
            <nav class="nav">
                <a href="{{ route('dashboard') }}">ダッシュボード</a>
                <a href="{{ route('devices.index') }}">デバイス</a>
                <a href="{{ route('temperature-data.index') }}">温度データ</a>
                @if(auth()->user()->is_admin)
                    <a href="{{ route('admin.users') }}">ユーザー管理</a>
                @endif
                <a href="{{ route('settings') }}">設定</a>
            </nav>
            
            <div class="user-info">
                <span>{{ auth()->user()->name }}</span>
                @if(auth()->user()->is_admin)
                    <span class="status status-online">管理者</span>
                @endif
                <form method="POST" action="{{ route('logout') }}" style="display: inline;">
                    @csrf
                    <button type="submit" class="btn btn-danger" style="padding: 0.5rem 1rem;">ログアウト</button>
                </form>
            </div>
        </div>
    </header>

    <main class="main">
        @if(session('success'))
            <div class="alert alert-success">{{ session('success') }}</div>
        @endif
        
        @if(session('error'))
            <div class="alert alert-error">{{ session('error') }}</div>
        @endif

        @yield('content')
    </main>
</body>
</html>