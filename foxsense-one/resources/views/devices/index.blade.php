@extends('layouts.app')

@section('title', 'デバイス管理 - FoxSense One')

@section('content')
<!-- Success/Error Messages -->
@if(session('success'))
    <div style="background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
        ✅ {{ session('success') }}
    </div>
@endif

@if(session('warning'))
    <div style="background: #fef3c7; border: 1px solid #fde68a; color: #92400e; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
        ⚠️ {{ session('warning') }}
        @if(session('delete_device_id'))
            <div style="margin-top: 1rem;">
                <form method="POST" action="{{ route('devices.delete', session('delete_device_id')) }}" style="display: inline;">
                    @csrf
                    @method('DELETE')
                    <input type="hidden" name="confirm" value="1">
                    <button type="submit" class="btn" style="background: #dc2626; color: white; margin-right: 0.5rem;">確認して削除</button>
                </form>
                <button type="button" onclick="window.location.reload()" class="btn" style="background: #6b7280;">キャンセル</button>
            </div>
        @endif
    </div>
@endif

@if(session('error'))
    <div style="background: #fee2e2; border: 1px solid #fecaca; color: #991b1b; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
        ❌ {{ session('error') }}
    </div>
@endif

@if($errors->any())
    <div style="background: #fee2e2; border: 1px solid #fecaca; color: #991b1b; padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
        <ul style="margin: 0; padding-left: 1.5rem;">
            @foreach($errors->all() as $error)
                <li>{{ $error }}</li>
            @endforeach
        </ul>
    </div>
@endif

<div class="card">
    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span>デバイス管理</span>
        <button type="button" class="btn" data-action="toggle-add-form">デバイス追加</button>
    </div>
    <div class="card-body">
        <!-- デバイス追加フォーム -->
        <div id="addDeviceForm" style="display: none; background: #f8fafc; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border: 2px solid #e5e7eb;">
            <h4 style="margin-bottom: 1rem; color: #374151;">新しいデバイスを追加</h4>
            
            <form method="POST" action="{{ route('devices.store') }}">
                @csrf
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div class="form-group">
                        <label for="sigfox_id">Sigfox ID <span style="color: red;">*</span></label>
                        <input type="text" id="sigfox_id" name="sigfox_id" class="form-control" required maxlength="8" style="text-transform: uppercase;">
                        <small style="color: #6b7280;">8桁の英数字ID（例：ABCD1234）</small>
                    </div>
                    
                    <div class="form-group">
                        <label for="name">デバイス名 <span style="color: red;">*</span></label>
                        <input type="text" id="name" name="name" class="form-control" required maxlength="255">
                    </div>
                </div>
                
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label for="location">設置場所</label>
                    <input type="text" id="location" name="location" class="form-control" maxlength="255">
                </div>
                
                <div style="display: flex; gap: 1rem;">
                    <button type="submit" class="btn">デバイスを追加</button>
                    <button type="button" class="btn" style="background: #6b7280;" data-action="hide-add-form">キャンセル</button>
                </div>
            </form>
        </div>
        
        @if($devices->count() > 0)
            <table class="table">
                <thead>
                    <tr>
                        <th>デバイス名</th>
                        <th>Sigfox ID</th>
                        <th>場所</th>
                        <th>最新温度</th>
                        <th>バッテリー</th>
                        <th>最終受信</th>
                        <th>状態</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($devices as $device)
                    <tr>
                        <td>{{ $device->device_name }}</td>
                        <td>{{ $device->sigfox_id ?? $device->sigfox_device_id }}</td>
                        <td>{{ $device->location ?? '-' }}</td>
                        <td>
                            @if($device->latest_temperature)
                                {{ $device->latest_temperature }}°C
                            @else
                                -
                            @endif
                        </td>
                        <td>
                            @if($device->battery_level)
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div style="width: 60px; height: 20px; border: 2px solid #374151; border-radius: 4px; position: relative; background: #f3f4f6;">
                                        <div style="height: 100%; border-radius: 2px; background: 
                                            @if($device->battery_level >= 75) #059669
                                            @elseif($device->battery_level >= 50) #3b82f6
                                            @elseif($device->battery_level >= 25) #f59e0b
                                            @else #dc2626
                                            @endif; width: {{ $device->battery_level }}%;"></div>
                                    </div>
                                    <span style="font-size: 0.875rem; font-weight: 600;">{{ $device->battery_level }}%</span>
                                </div>
                                @if($device->battery_voltage)
                                    <small style="color: #6b7280;">{{ $device->battery_voltage }}V</small>
                                @endif
                            @else
                                -
                            @endif
                        </td>
                        <td>
                            @if($device->last_seen)
                                {{ $device->last_seen->format('m/d H:i') }}
                            @else
                                -
                            @endif
                        </td>
                        <td>
                            @if($device->isOnline())
                                <span class="status status-online">オンライン</span>
                            @else
                                <span class="status status-offline">オフライン</span>
                            @endif
                        </td>
                        <td>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <a href="{{ route('devices.detail', $device->id) }}" class="btn" style="padding: 0.5rem 1rem; background: #3b82f6;">詳細</a>
                                <a href="{{ route('devices.edit', $device->id) }}" class="btn" style="padding: 0.5rem 1rem; background: #f59e0b;">編集</a>
                                <form method="POST" action="{{ route('devices.delete', $device->id) }}" style="display: inline;" onsubmit="return confirm('本当にこのデバイスを削除しますか？関連するデータも全て削除されます。')">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit" class="btn" style="padding: 0.5rem 1rem; background: #dc2626; color: white;">削除</button>
                                </form>
                            </div>
                        </td>
                    </tr>
                    @endforeach
                </tbody>
            </table>
        @else
            <p style="text-align: center; color: #6b7280; padding: 2rem;">
                デバイスがありません。右上の「デバイス追加」ボタンから新しいデバイスを登録してください。
            </p>
        @endif
    </div>
</div>


<script src="{{ asset('js/devices.js') }}"></script>
@endsection