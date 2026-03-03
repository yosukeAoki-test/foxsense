@extends('layouts.app')

@section('title', 'ユーザー管理 - FoxSense One')

@section('content')
<style>
    .user-card {
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        transition: all 0.3s ease;
        border: 1px solid #e5e7eb;
        overflow: hidden;
    }
    .user-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        border-color: #16a34a;
    }
    .avatar-gradient-1 { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .avatar-gradient-2 { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    .avatar-gradient-3 { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); }
    .avatar-gradient-4 { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
    .avatar-gradient-5 { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
    .avatar-gradient-6 { background: linear-gradient(135deg, #30cfd0 0%, #330867 100%); }
    
    .stat-card {
        background: linear-gradient(135deg, #16a34a 0%, #059669 100%);
        color: white;
        padding: 1.5rem;
        border-radius: 12px;
        position: relative;
        overflow: hidden;
    }
    .stat-card::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
        animation: pulse 4s ease-in-out infinite;
    }
    @keyframes pulse {
        0% { transform: scale(0.8); opacity: 0.5; }
        50% { transform: scale(1.2); opacity: 0.3; }
        100% { transform: scale(0.8); opacity: 0.5; }
    }
    
    .action-btn {
        padding: 0.5rem 1rem;
        border-radius: 8px;
        font-weight: 600;
        transition: all 0.3s ease;
        text-decoration: none;
        display: inline-block;
    }
    .edit-btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
    }
    .edit-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .delete-btn {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        border: none;
        cursor: pointer;
    }
    .delete-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(245, 87, 108, 0.4);
    }
    
    .search-box {
        background: white;
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 0.75rem 1rem;
        transition: all 0.3s ease;
    }
    .search-box:focus {
        border-color: #16a34a;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
        outline: none;
    }
</style>

<!-- ヘッダーセクション -->
<div style="background: linear-gradient(135deg, #16a34a 0%, #059669 100%); padding: 2rem 0; margin: -2rem -1rem 2rem -1rem;">
    <div style="max-width: 1200px; margin: 0 auto; padding: 0 2rem;">
        <h1 style="font-size: 2.5rem; font-weight: bold; color: white; margin-bottom: 0.5rem;">
            👥 ユーザー管理
        </h1>
        <p style="color: rgba(255,255,255,0.9); font-size: 1.125rem;">
            システムに登録されているユーザーの管理と権限設定
        </p>
    </div>
</div>

<div style="max-width: 1200px; margin: 0 auto; padding: 0 1rem;">
    <!-- 統計カード -->
    <div class="grid grid-3" style="margin-bottom: 2rem;">
        <div class="stat-card">
            <div style="position: relative; z-index: 1;">
                <div style="font-size: 2.5rem; font-weight: bold;">{{ $users->total() }}</div>
                <div style="opacity: 0.9;">総ユーザー数</div>
            </div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div style="position: relative; z-index: 1;">
                <div style="font-size: 2.5rem; font-weight: bold;">
                    {{ $users->filter(function($u) { return $u->is_admin; })->count() }}
                </div>
                <div style="opacity: 0.9;">管理者</div>
            </div>
        </div>
        <div class="stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
            <div style="position: relative; z-index: 1;">
                <div style="font-size: 2.5rem; font-weight: bold;">
                    {{ $users->sum('devices_count') }}
                </div>
                <div style="opacity: 0.9;">総デバイス数</div>
            </div>
        </div>
    </div>

    <!-- 検索・フィルター -->
    <div class="card" style="margin-bottom: 2rem; border-radius: 12px; overflow: visible;">
        <div class="card-body">
            <form method="GET" action="{{ route('admin.users') }}" style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
                <div style="flex: 1; min-width: 200px;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">
                        🔍 ユーザー検索
                    </label>
                    <input type="text" name="search" value="{{ request('search') }}" 
                           placeholder="名前やメールアドレスで検索..." 
                           class="search-box"
                           style="width: 100%;">
                </div>
                
                <div style="min-width: 180px;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: #374151;">
                        👤 権限フィルター
                    </label>
                    <select name="admin_filter" class="search-box" style="width: 100%;">
                        <option value="">すべて表示</option>
                        <option value="admin" {{ request('admin_filter') == 'admin' ? 'selected' : '' }}>👑 管理者のみ</option>
                        <option value="user" {{ request('admin_filter') == 'user' ? 'selected' : '' }}>👤 一般ユーザーのみ</option>
                    </select>
                </div>
                
                <div style="display: flex; gap: 0.5rem;">
                    <button type="submit" class="btn">
                        検索
                    </button>
                    <a href="{{ route('admin.users') }}" class="btn" style="background: #6b7280;">
                        リセット
                    </a>
                </div>
            </form>
        </div>
    </div>

    <!-- ユーザー一覧（カード形式） -->
    <div class="grid grid-2" style="gap: 1.5rem;">
        @forelse($users as $index => $user)
            <div class="user-card">
                <!-- カードヘッダー -->
                <div style="padding: 1.5rem; border-bottom: 1px solid #e5e7eb;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <!-- アバター -->
                        <div class="avatar-gradient-{{ ($index % 6) + 1 }}" 
                             style="width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.5rem; font-weight: bold; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                            {{ mb_substr($user->name, 0, 1) }}
                        </div>
                        
                        <!-- ユーザー情報 -->
                        <div style="flex: 1;">
                            <div style="font-size: 1.25rem; font-weight: bold; color: #111827; margin-bottom: 0.25rem;">
                                {{ $user->name }}
                                @if($user->is_admin)
                                    <span style="display: inline-block; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: white; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; margin-left: 0.5rem; vertical-align: middle;">
                                        👑 管理者
                                    </span>
                                @endif
                            </div>
                            <div style="color: #6b7280; font-size: 0.875rem;">
                                ✉️ {{ $user->email }}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- カード本体 -->
                <div style="padding: 1.5rem; background: #f9fafb;">
                    <div class="grid grid-3" style="gap: 1rem; margin-bottom: 1rem;">
                        <div style="text-align: center; padding: 1rem; background: white; border-radius: 8px;">
                            <div style="font-size: 1.5rem; font-weight: bold; color: #4f46e5;">
                                {{ $user->devices_count }}
                            </div>
                            <div style="font-size: 0.875rem; color: #6b7280;">デバイス</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: white; border-radius: 8px;">
                            <div style="font-size: 1.5rem; font-weight: bold; color: #059669;">
                                {{ $user->user_emails_count }}
                            </div>
                            <div style="font-size: 0.875rem; color: #6b7280;">メール</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: white; border-radius: 8px;">
                            <div style="font-size: 1rem; font-weight: bold; color: #dc2626;">
                                {{ $user->created_at->diffForHumans() }}
                            </div>
                            <div style="font-size: 0.875rem; color: #6b7280;">登録</div>
                        </div>
                    </div>
                    
                    <!-- アクションボタン -->
                    <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
                        <a href="{{ route('admin.users.edit', $user->id) }}" class="action-btn edit-btn" style="flex: 1; text-align: center;">
                            ✏️ 編集
                        </a>
                        @if($user->id !== auth()->id())
                            <form method="POST" action="{{ route('admin.users.delete', $user->id) }}" style="flex: 1;">
                                @csrf
                                @method('DELETE')
                                <button type="submit" class="action-btn delete-btn" style="width: 100%;"
                                        onclick="return confirm('ユーザー「{{ $user->name }}」を完全に削除しますか？\n\n削除される内容：\n• ユーザーアカウント情報\n• 登録されている{{ $user->devices_count }}台のデバイス\n• 全ての温度測定データ\n• {{ $user->user_emails_count }}件の通知用メールアドレス\n\nこの操作は取り消せません。')">
                                    🗑️ 削除
                                </button>
                            </form>
                        @else
                            <div style="flex: 1; text-align: center; padding: 0.5rem 1rem; background: #e5e7eb; border-radius: 8px; color: #6b7280;">
                                自分自身
                            </div>
                        @endif
                    </div>
                </div>
            </div>
        @empty
            <div style="grid-column: 1 / -1;">
                <div class="card" style="text-align: center; padding: 4rem 2rem;">
                    <div style="font-size: 4rem; margin-bottom: 1rem;">🔍</div>
                    <h3 style="font-size: 1.5rem; color: #374151; margin-bottom: 0.5rem;">
                        ユーザーが見つかりません
                    </h3>
                    <p style="color: #6b7280;">
                        検索条件を変更してお試しください
                    </p>
                </div>
            </div>
        @endforelse
    </div>
    
    <!-- ページネーション -->
    @if($users->hasPages())
        <div style="margin-top: 2rem; padding: 1rem; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            {{ $users->appends(request()->query())->links() }}
        </div>
    @endif
</div>
@endsection