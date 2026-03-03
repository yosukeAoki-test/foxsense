@extends('layouts.app')

@section('title', '設定 - FoxSense One')

@section('content')
<div class="grid grid-2">
    <!-- ユーザー設定 -->
    <div class="card">
        <div class="card-header">ユーザー設定</div>
        <div class="card-body">
            <div class="form-group">
                <label>ユーザー名</label>
                <input type="text" class="form-control" value="{{ auth()->user()->username }}" disabled>
            </div>
            
            <div class="form-group">
                <label>メールアドレス</label>
                <input type="email" class="form-control" value="{{ auth()->user()->email }}" disabled>
            </div>
            
            <div class="form-group">
                <label>名前</label>
                <input type="text" class="form-control" value="{{ auth()->user()->name }}" disabled>
            </div>
            
            <div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 6px;">
                <h4 style="margin-bottom: 0.5rem; color: #1e40af;">通知閾値について</h4>
                <p style="color: #374151; margin: 0; line-height: 1.6;">
                    温度の通知閾値はデバイスごとに設定できます。各デバイスの詳細画面から設定を行ってください。
                    <a href="{{ route('devices.index') }}" style="color: #1e40af; text-decoration: underline;">デバイス一覧へ</a>
                </p>
            </div>
        </div>
    </div>

    <!-- システム情報 -->
    <div class="card">
        <div class="card-header">システム情報</div>
        <div class="card-body">
            <table class="table">
                <tr>
                    <th style="width: 50%;">アカウント種別</th>
                    <td>
                        @if(auth()->user()->is_admin)
                            <span class="status status-online">管理者</span>
                        @else
                            <span class="status" style="background: #e5e7eb; color: #374151;">一般ユーザー</span>
                        @endif
                    </td>
                </tr>
                <tr>
                    <th>登録日</th>
                    <td>{{ auth()->user()->created_at->format('Y年m月d日') }}</td>
                </tr>
                <tr>
                    <th>所有デバイス数</th>
                    <td>
                        <strong>{{ auth()->user()->devices()->count() }}</strong> 台
                    </td>
                </tr>
                <tr>
                    <th>総データ数</th>
                    <td>
                        <strong>{{ number_format(auth()->user()->devices()->withCount('temperatureData')->get()->sum('temperature_data_count')) }}</strong> 件
                    </td>
                </tr>
                @if(auth()->user()->is_admin)
                <tr>
                    <th>総ユーザー数</th>
                    <td><strong>{{ $totalUsers ?? 0 }}</strong> 名</td>
                </tr>
                <tr>
                    <th>システム総デバイス数</th>
                    <td><strong>{{ $totalDevices ?? 0 }}</strong> 台</td>
                </tr>
                @endif
            </table>
        </div>
    </div>
</div>

<!-- 通知設定 -->
<div class="card" style="margin-top: 2rem;">
    <div class="card-header">通知メールアドレス管理</div>
    <div class="card-body">
        <div style="margin-bottom: 1rem;">
            <a href="{{ route('emails.index') }}" class="btn">メールアドレス管理画面へ</a>
        </div>
        
        <p style="color: #6b7280;">
            温度異常時の通知先メールアドレスを管理できます。複数のメールアドレスを登録可能です。
        </p>
        
        @php
            $emailCount = auth()->user()->userEmails()->count();
        @endphp
        
        <div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;">
            <strong>📧 通知先設定：</strong><br>
            • メイン: {{ auth()->user()->email }}<br>
            @if($emailCount > 0)
                • 追加通知先: {{ $emailCount }} 件
            @else
                • 追加通知先: なし（<a href="{{ route('emails.index') }}" style="color: #0c4a6e;">追加設定</a>）
            @endif
        </div>
    </div>
</div>

<!-- データ管理 -->
<div class="card" style="margin-top: 2rem;">
    <div class="card-header">データ管理</div>
    <div class="card-body">
        <div class="grid grid-2">
            <div>
                <h4 style="margin-bottom: 1rem;">データエクスポート</h4>
                <p style="color: #6b7280; margin-bottom: 1rem;">
                    すべての温度データをCSV形式でダウンロードできます。
                </p>
                <form method="GET" action="{{ route('temperature-data.export') }}">
                    <div class="form-group">
                        <label for="export_start">開始日</label>
                        <input type="date" id="export_start" name="start_date" class="form-control" 
                               value="{{ now()->subMonth()->format('Y-m-d') }}" required>
                    </div>
                    <div class="form-group">
                        <label for="export_end">終了日</label>
                        <input type="date" id="export_end" name="end_date" class="form-control" 
                               value="{{ now()->format('Y-m-d') }}" required>
                    </div>
                    <button type="submit" class="btn btn-success">CSVダウンロード</button>
                </form>
            </div>
            
        </div>
    </div>
</div>

@endsection