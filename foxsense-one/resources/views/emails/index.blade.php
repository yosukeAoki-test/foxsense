@extends('layouts.app')

@section('title', '通知メールアドレス管理 - FoxSense One')

@section('content')
<div class="card">
    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span>通知メールアドレス管理</span>
        <a href="{{ route('settings') }}" class="btn" style="padding: 0.5rem 1rem;">設定に戻る</a>
    </div>
    <div class="card-body">
        <!-- 新規追加フォーム -->
        <div class="card" style="margin-bottom: 2rem; background: #f8fafc;">
            <div class="card-body">
                <h4 style="margin-bottom: 1rem;">メールアドレス追加</h4>
                <form method="POST" action="{{ route('emails.store') }}">
                    @csrf
                    <div style="display: flex; gap: 1rem;">
                        <input type="email" 
                               name="email" 
                               class="form-control" 
                               placeholder="example@email.com" 
                               required 
                               style="flex: 1;">
                        <button type="submit" class="btn">追加</button>
                    </div>
                </form>
                <p style="margin-top: 0.5rem; font-size: 0.875rem; color: #6b7280;">
                    温度異常時に通知を受け取るメールアドレスを追加できます。<br>
                    <strong style="color: #059669;">📧 追加時に自動でテストメールが送信されます。</strong>
                </p>
            </div>
        </div>

        <!-- 登録済みメールアドレス一覧 -->
        <h4 style="margin-bottom: 1rem;">登録済みメールアドレス</h4>
        
        @if($emails->count() > 0)
            <table class="table">
                <thead>
                    <tr>
                        <th>メールアドレス</th>
                        <th>登録日</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($emails as $email)
                    <tr>
                        <td>
                            <strong>{{ $email->email }}</strong>
                        </td>
                        <td>
                            {{ $email->created_at->format('Y/m/d H:i') }}
                            <small style="color: #6b7280; display: block;">
                                {{ $email->created_at->diffForHumans() }}
                            </small>
                        </td>
                        <td>
                            <div style="display: flex; gap: 0.5rem;">
                                <!-- テストメール送信ボタン -->
                                <form method="POST" action="{{ route('emails.test', $email) }}" style="display: inline;">
                                    @csrf
                                    <button type="submit" 
                                            class="btn" 
                                            style="padding: 0.5rem 1rem; background: #059669;"
                                            title="このメールアドレスにテストメールを送信">
                                        テスト
                                    </button>
                                </form>
                                <!-- 削除ボタン -->
                                <form method="POST" action="{{ route('emails.destroy', $email) }}" style="display: inline;">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit" 
                                            class="btn btn-danger" 
                                            style="padding: 0.5rem 1rem;"
                                            onclick="return confirm('このメールアドレスを削除してもよろしいですか？')">
                                        削除
                                    </button>
                                </form>
                            </div>
                        </td>
                    </tr>
                    @endforeach
                </tbody>
            </table>
        @else
            <div style="text-align: center; padding: 3rem; background: #f0f9ff; border-radius: 6px; border: 1px solid #bae6fd;">
                <p style="color: #0c4a6e; margin-bottom: 1rem;">
                    📧 メイン通知先: {{ auth()->user()->email }}<br>
                    追加の通知先メールアドレスはありません
                </p>
                <p style="font-size: 0.875rem; color: #0369a1;">
                    上のフォームから追加の通知先を設定できます
                </p>
            </div>
        @endif

        <!-- 通知設定の説明 -->
        <div class="card" style="margin-top: 2rem; background: #f0f9ff;">
            <div class="card-body">
                <h4 style="margin-bottom: 1rem; color: #1e40af;">通知について</h4>
                <ul style="color: #374151; line-height: 1.8;">
                    <li>登録されたメールアドレスには、以下の場合に通知が送信されます：</li>
                    <ul style="margin-top: 0.5rem; margin-left: 1rem;">
                        <li>温度が設定した下限閾値を下回った場合</li>
                        <li>温度が設定した上限閾値を上回った場合</li>
                        <li>デバイスのバッテリー残量が20%以下になった場合</li>
                        <li>デバイスが長時間（1時間以上）オフラインになった場合</li>
                    </ul>
                    <li style="margin-top: 0.5rem;">通知の閾値は「設定」画面から変更できます</li>
                    <li>複数のメールアドレスを登録した場合、すべてのアドレスに同じ通知が送信されます</li>
                </ul>
            </div>
        </div>
    </div>
</div>
@endsection