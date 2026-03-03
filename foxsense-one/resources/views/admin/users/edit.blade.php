@extends('layouts.app')

@section('title', 'ユーザー編集 - FoxSense One')

@section('content')
<style>
    .edit-container {
        max-width: 1200px;
        margin: 0 auto;
    }
    
    .info-card {
        background: white;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        border: 1px solid #e5e7eb;
        margin-bottom: 2rem;
    }
    
    .stat-box {
        background: linear-gradient(135deg, #f9fafb 0%, #e5e7eb 100%);
        border-radius: 12px;
        padding: 1.5rem;
        text-align: center;
        transition: all 0.3s ease;
    }
    .stat-box:hover {
        transform: translateY(-3px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.1);
    }
    
    .device-card {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 1.5rem;
        transition: all 0.3s ease;
        position: relative;
    }
    .device-card:hover {
        box-shadow: 0 6px 16px rgba(0,0,0,0.1);
        transform: translateY(-2px);
    }
    
    .form-input {
        width: 100%;
        padding: 0.875rem 1.25rem;
        border: 2px solid #e5e7eb;
        border-radius: 10px;
        font-size: 1rem;
        transition: all 0.3s ease;
        background: white;
    }
    .form-input:focus {
        outline: none;
        border-color: #16a34a;
        box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.1);
    }
    .form-input.error {
        border-color: #dc2626;
        background: #fef2f2;
    }
    
    .admin-toggle {
        position: relative;
        display: inline-block;
        width: 60px;
        height: 34px;
    }
    .admin-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
    }
    .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: #cbd5e0;
        transition: 0.4s;
        border-radius: 34px;
    }
    .slider:before {
        position: absolute;
        content: "";
        height: 26px;
        width: 26px;
        left: 4px;
        bottom: 4px;
        background: white;
        transition: 0.4s;
        border-radius: 50%;
    }
    input:checked + .slider {
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
    }
    input:checked + .slider:before {
        transform: translateX(26px);
    }
    
    .avatar-circle {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 3rem;
        font-weight: bold;
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        margin: 0 auto 1.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .action-btn {
        padding: 0.875rem 2rem;
        border-radius: 10px;
        font-weight: 600;
        transition: all 0.3s ease;
        border: none;
        cursor: pointer;
        font-size: 1rem;
        text-decoration: none;
        display: inline-block;
    }
    .save-btn {
        background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
        color: white;
        box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3);
    }
    .save-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(22, 163, 74, 0.4);
    }
    .cancel-btn {
        background: #6b7280;
        color: white;
    }
    .cancel-btn:hover {
        background: #4b5563;
    }
    .delete-data-btn {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: white;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
    }
    .delete-data-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
    }
    .delete-device-btn {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: white;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
    }
    .delete-device-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
    }
</style>

<!-- ヘッダーセクション -->
<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 3rem 0; margin: -2rem -1rem 3rem -1rem;">
    <div class="edit-container" style="padding: 0 2rem;">
        <h1 style="font-size: 2.5rem; font-weight: bold; color: white; margin-bottom: 0.5rem;">
            ✏️ ユーザー編集
        </h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 1.125rem;">
            ユーザー情報と権限の編集
        </p>
    </div>
</div>

<div class="edit-container">
    <!-- 警告メッセージ -->
    @if(session('warning'))
        <div style="background: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 1rem; border-radius: 12px; margin-bottom: 1rem;">
            ⚠️ {{ session('warning') }}
            @if(session('delete_device_data_id'))
                <div style="margin-top: 1rem;">
                    <form method="POST" action="{{ route('admin.devices.delete-data', session('delete_device_data_id')) }}" style="display: inline;">
                        @csrf
                        @method('DELETE')
                        <input type="hidden" name="confirm" value="1">
                        <button type="submit" class="action-btn delete-data-btn">確認してデータを削除</button>
                    </form>
                    <button type="button" onclick="window.location.reload()" class="action-btn cancel-btn" style="margin-left: 0.5rem;">キャンセル</button>
                </div>
            @endif
            @if(session('admin_delete_device_id'))
                <div style="margin-top: 1rem;">
                    <form method="POST" action="{{ route('admin.devices.delete', session('admin_delete_device_id')) }}" style="display: inline;">
                        @csrf
                        @method('DELETE')
                        <input type="hidden" name="confirm" value="1">
                        <button type="submit" class="action-btn delete-device-btn">確認してデバイスを削除</button>
                    </form>
                    <button type="button" onclick="window.location.reload()" class="action-btn cancel-btn" style="margin-left: 0.5rem;">キャンセル</button>
                </div>
            @endif
        </div>
    @endif

    <!-- ユーザー情報カード -->
    <div class="info-card">
        <div class="avatar-circle">
            {{ mb_substr($user->name, 0, 1) }}
        </div>
        
        <h2 style="text-align: center; font-size: 1.75rem; font-weight: bold; color: #111827; margin-bottom: 0.5rem;">
            {{ $user->name }}
        </h2>
        <p style="text-align: center; color: #6b7280; margin-bottom: 2rem;">
            {{ $user->email }}
        </p>
        
        <!-- 統計情報 -->
        <div class="grid grid-4" style="gap: 1rem; margin-bottom: 2rem;">
            <div class="stat-box">
                <div style="font-size: 2rem; font-weight: bold; color: #4f46e5;">
                    🔧
                </div>
                <div style="font-size: 1.5rem; font-weight: bold; color: #111827;">
                    {{ $user->devices_count }}
                </div>
                <div style="font-size: 0.875rem; color: #6b7280;">
                    デバイス
                </div>
            </div>
            
            <div class="stat-box">
                <div style="font-size: 2rem; font-weight: bold; color: #059669;">
                    ✉️
                </div>
                <div style="font-size: 1.5rem; font-weight: bold; color: #111827;">
                    {{ $user->user_emails_count }}
                </div>
                <div style="font-size: 0.875rem; color: #6b7280;">
                    メール
                </div>
            </div>
            
            <div class="stat-box">
                <div style="font-size: 2rem; font-weight: bold; color: #dc2626;">
                    📅
                </div>
                <div style="font-size: 1rem; font-weight: bold; color: #111827;">
                    {{ $user->created_at->format('Y/m/d') }}
                </div>
                <div style="font-size: 0.875rem; color: #6b7280;">
                    登録日
                </div>
            </div>
            
            <div class="stat-box">
                <div style="font-size: 2rem; font-weight: bold; color: #f59e0b;">
                    🔄
                </div>
                <div style="font-size: 1rem; font-weight: bold; color: #111827;">
                    {{ $user->updated_at->diffForHumans() }}
                </div>
                <div style="font-size: 0.875rem; color: #6b7280;">
                    最終更新
                </div>
            </div>
        </div>
    </div>

    <!-- デバイス一覧 -->
    @if($user->devices->count() > 0)
    <div class="info-card">
        <h3 style="font-size: 1.5rem; font-weight: bold; color: #111827; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e5e7eb;">
            🔧 登録デバイス一覧
        </h3>
        
        <div class="grid grid-2" style="gap: 1.5rem;">
            @foreach($user->devices as $device)
                <div class="device-card">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                        <div>
                            <h4 style="font-size: 1.25rem; font-weight: bold; color: #111827; margin-bottom: 0.25rem;">
                                {{ $device->device_name }}
                            </h4>
                            <p style="color: #6b7280; font-size: 0.875rem;">
                                ID: {{ $device->sigfox_device_id }}
                            </p>
                        </div>
                        <div>
                            @if($device->isOnline())
                                <span style="display: inline-block; background: #d1fae5; color: #065f46; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem;">
                                    🟢 オンライン
                                </span>
                            @else
                                <span style="display: inline-block; background: #fee2e2; color: #991b1b; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem;">
                                    🔴 オフライン
                                </span>
                            @endif
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div style="padding: 0.75rem; background: #f9fafb; border-radius: 8px;">
                            <div style="font-size: 0.75rem; color: #6b7280;">場所</div>
                            <div style="font-weight: 600;">{{ $device->location ?: '未設定' }}</div>
                        </div>
                        <div style="padding: 0.75rem; background: #f9fafb; border-radius: 8px;">
                            <div style="font-size: 0.75rem; color: #6b7280;">データ数</div>
                            <div style="font-weight: 600;">{{ $device->temperature_data_count }}件</div>
                        </div>
                    </div>
                    
                    @if($device->latestTemperatureData->first())
                        <div style="padding: 0.75rem; background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 8px; margin-bottom: 1rem;">
                            <div style="font-size: 0.75rem; color: #1e40af;">最新データ</div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 1.25rem; font-weight: bold; color: #1e40af;">
                                    🌡️ {{ $device->latestTemperatureData->first()->temperature }}°C
                                </div>
                                <div style="font-size: 0.75rem; color: #3730a3;">
                                    {{ $device->latestTemperatureData->first()->created_at->diffForHumans() }}
                                </div>
                            </div>
                        </div>
                    @endif
                    
                    <div style="display: flex; gap: 0.5rem;">
                        <a href="{{ route('devices.detail', $device->id) }}" 
                           class="action-btn" 
                           style="background: #3b82f6; color: white; padding: 0.5rem 1rem; font-size: 0.875rem; flex: 1; text-align: center;">
                            📊 詳細
                        </a>
                        <form method="POST" action="{{ route('admin.devices.delete-data', $device->id) }}" style="flex: 1;">
                            @csrf
                            @method('DELETE')
                            <button type="submit" class="action-btn delete-data-btn" style="width: 100%;"
                                    onclick="return confirm('デバイス「{{ $device->device_name }}」の全データを削除しますか？')">
                                🗑️ データ削除
                            </button>
                        </form>
                        <form method="POST" action="{{ route('admin.devices.delete', $device->id) }}" style="flex: 1;">
                            @csrf
                            @method('DELETE')
                            <button type="submit" class="action-btn delete-device-btn" style="width: 100%;"
                                    onclick="return confirm('デバイス「{{ $device->device_name }}」を完全に削除しますか？\n\n削除される内容：\n• デバイス設定情報\n• {{ number_format($device->temperature_data_count) }}件の温度データ\n• データ収集履歴\n\nこの操作は取り消せません。')">
                                ❌ デバイス削除
                            </button>
                        </form>
                    </div>
                </div>
            @endforeach
        </div>
    </div>
    @endif
    
    <!-- 編集フォーム -->
    <div class="info-card">
        <h3 style="font-size: 1.5rem; font-weight: bold; color: #111827; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #e5e7eb;">
            📝 ユーザー情報を編集
        </h3>
        
        <form method="POST" action="{{ route('admin.users.update', $user->id) }}">
            @csrf
            @method('PUT')
            
            <!-- 名前 -->
            <div style="margin-bottom: 1.5rem;">
                <label for="name" style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">
                    👤 名前
                </label>
                <input type="text" 
                       name="name" 
                       id="name"
                       value="{{ old('name', $user->name) }}" 
                       class="form-input @error('name') error @enderror" 
                       required>
                @error('name')
                    <p style="color: #dc2626; font-size: 0.875rem; margin-top: 0.5rem;">
                        ⚠️ {{ $message }}
                    </p>
                @enderror
            </div>

            <!-- メールアドレス -->
            <div style="margin-bottom: 1.5rem;">
                <label for="email" style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">
                    ✉️ メールアドレス
                </label>
                <input type="email" 
                       name="email" 
                       id="email"
                       value="{{ old('email', $user->email) }}" 
                       class="form-input @error('email') error @enderror" 
                       required>
                @error('email')
                    <p style="color: #dc2626; font-size: 0.875rem; margin-top: 0.5rem;">
                        ⚠️ {{ $message }}
                    </p>
                @enderror
            </div>

            <!-- パスワード変更 -->
            <div style="margin-bottom: 1.5rem; padding: 1.5rem; background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px;">
                <label style="display: block; font-weight: 600; color: #1e40af; margin-bottom: 1rem;">
                    🔐 パスワード変更
                </label>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div style="background: white; padding: 1rem; border-radius: 8px;">
                        <label for="new_password" style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">
                            新しいパスワード
                        </label>
                        <input type="password" 
                               name="new_password" 
                               id="new_password"
                               placeholder="新しいパスワードを入力"
                               class="form-input @error('new_password') error @enderror">
                        @error('new_password')
                            <p style="color: #dc2626; font-size: 0.875rem; margin-top: 0.5rem;">
                                ⚠️ {{ $message }}
                            </p>
                        @enderror
                    </div>
                    
                    <div style="background: white; padding: 1rem; border-radius: 8px;">
                        <label for="new_password_confirmation" style="display: block; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">
                            パスワード確認
                        </label>
                        <input type="password" 
                               name="new_password_confirmation" 
                               id="new_password_confirmation"
                               placeholder="新しいパスワードを再入力"
                               class="form-input">
                    </div>
                </div>
                
                <div style="background: white; padding: 1rem; border-radius: 8px; margin-top: 1rem; border-left: 4px solid #3b82f6;">
                    <div style="font-size: 0.875rem; color: #6b7280;">
                        <strong>パスワードの要件:</strong><br>
                        • 8文字以上<br>
                        • 英大文字・小文字・数字を含む<br>
                        • 特殊文字(@$!%*?&)の使用を推奨<br>
                        <br>
                        <strong style="color: #1e40af;">※ 管理者権限により、現在のパスワード確認なしで変更可能です</strong>
                    </div>
                </div>
            </div>

            <!-- 管理者権限 -->
            <div style="margin-bottom: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px;">
                <label style="display: block; font-weight: 600; color: #92400e; margin-bottom: 1rem;">
                    👑 管理者権限
                </label>
                
                @if($canChangeAdminStatus)
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <label class="admin-toggle">
                            <input type="hidden" name="is_admin" value="0">
                            <input type="checkbox" 
                                   name="is_admin" 
                                   value="1" 
                                   {{ old('is_admin', $user->is_admin) ? 'checked' : '' }}>
                            <span class="slider"></span>
                        </label>
                        <div>
                            <div style="font-weight: 600; color: #111827;">
                                管理者権限を付与
                            </div>
                            <div style="font-size: 0.875rem; color: #6b7280; margin-top: 0.25rem;">
                                管理者は全てのユーザーとデバイスにアクセス可能
                            </div>
                        </div>
                    </div>
                @else
                    <div style="padding: 1rem; background: white; border-radius: 8px; border-left: 4px solid #f59e0b;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; color: #92400e;">
                            ⚠️ <strong>自分自身の管理者権限は変更できません</strong>
                        </div>
                        <p style="font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem;">
                            セキュリティのため、自分の管理者権限を削除することはできません
                        </p>
                    </div>
                    <input type="hidden" name="is_admin" value="{{ $user->is_admin ? '1' : '0' }}">
                @endif
            </div>

            <!-- アクションボタン -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 2rem; border-top: 2px solid #e5e7eb;">
                <a href="{{ route('admin.users') }}" class="action-btn cancel-btn">
                    ⬅️ 戻る
                </a>
                
                <button type="submit" class="action-btn save-btn">
                    💾 変更を保存
                </button>
            </div>
        </form>
    </div>
</div>
@endsection