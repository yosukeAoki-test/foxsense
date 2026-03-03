@extends('layouts.app')

@section('title', 'ダッシュボード - FoxSense One')

@section('content')
<div class="grid grid-4">
    <div class="card">
        <div class="card-header">総デバイス数</div>
        <div class="card-body">
            <div style="font-size: 2rem; font-weight: bold; color: #4f46e5;">{{ $stats['total_devices'] }}</div>
        </div>
    </div>
    
    <div class="card">
        <div class="card-header">アクティブデバイス</div>
        <div class="card-body">
            <div style="font-size: 2rem; font-weight: bold; color: #059669;">{{ $stats['active_devices'] }}</div>
        </div>
    </div>
    
    <div class="card">
        <div class="card-header">本日のデータ</div>
        <div class="card-body">
            <div style="font-size: 2rem; font-weight: bold; color: #dc2626;">{{ $stats['data_today'] }}</div>
        </div>
    </div>
    
    <div class="card">
        <div class="card-header">今週のデータ</div>
        <div class="card-body">
            <div style="font-size: 2rem; font-weight: bold; color: #7c3aed;">{{ $stats['data_this_week'] }}</div>
        </div>
    </div>
</div>

<div class="grid grid-2">
    <div class="card">
        <div class="card-header">最新の温度データ</div>
        <div class="card-body">
            @if($recentData->count() > 0)
                <table class="table">
                    <thead>
                        <tr>
                            <th>デバイス</th>
                            <th>温度</th>
                            <th>時刻</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach($recentData as $data)
                        <tr>
                            <td>{{ $data->device->device_name ?? 'Unknown' }}</td>
                            <td>{{ $data->temperature }}°C</td>
                            <td>{{ $data->sigfox_time ? $data->sigfox_time->format('m/d H:i') : '-' }}</td>
                        </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <p style="text-align: center; color: #6b7280;">データがありません</p>
            @endif
        </div>
    </div>
    
    <div class="card">
        <div class="card-header">デバイス状況</div>
        <div class="card-body">
            @if($deviceStats->count() > 0)
                @foreach($deviceStats as $device)
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #e5e7eb;">
                    <div>
                        <div style="font-weight: 600;">{{ $device->device_name }}</div>
                        <div style="font-size: 0.875rem; color: #6b7280;">{{ $device->location ?? 'Unknown' }}</div>
                    </div>
                    <div style="text-align: right;">
                        @if($device->latest_temperature)
                            <div style="font-weight: 600;">{{ $device->latest_temperature }}°C</div>
                            <div style="font-size: 0.875rem; color: #6b7280;">
                                {{ $device->last_seen ? $device->last_seen->format('m/d H:i') : '-' }}
                            </div>
                        @else
                            <span class="status status-offline">データなし</span>
                        @endif
                    </div>
                </div>
                @endforeach
            @else
                <p style="text-align: center; color: #6b7280;">デバイスがありません</p>
            @endif
        </div>
    </div>
</div>

@if(auth()->user()->is_admin)
<div class="card">
    <div class="card-header">管理者機能</div>
    <div class="card-body">
        <div class="grid grid-2" style="gap: 1rem; margin-bottom: 1rem;">
            <div>
                <h4 style="font-weight: 600; margin-bottom: 0.5rem;">👥 ユーザー管理</h4>
                <a href="{{ route('admin.users') }}" class="btn" style="width: 100%; display: block; text-align: center;">
                    ユーザー管理画面
                </a>
                <p style="margin-top: 0.25rem; font-size: 0.875rem; color: #6b7280;">
                    ユーザーの追加・編集・削除
                </p>
            </div>
            
            <div>
                <h4 style="font-weight: 600; margin-bottom: 0.5rem;">🔄 データ同期</h4>
                <form method="POST" action="{{ route('sync.sigfox') }}" style="display: block;">
                    @csrf
                    <button type="submit" class="btn" style="width: 100%;">Sigfoxデータ同期</button>
                </form>
                <p style="margin-top: 0.25rem; font-size: 0.875rem; color: #6b7280;">
                    Sigfox APIから最新データを取得
                </p>
            </div>
        </div>
    </div>
</div>
@endif
@endsection