@extends('layouts.app')

@section('title', 'デバイス編集')

@section('content')
<div class="container" style="max-width: 800px; margin: 0 auto; padding: 2rem;">
    <div class="card">
        <div class="card-header" style="display: flex; justify-content: between; align-items: center;">
            <h2>デバイス編集</h2>
            <a href="{{ route('devices.index') }}" class="btn" style="background: #6b7280;">戻る</a>
        </div>
        <div class="card-body">
            <form method="POST" action="{{ route('devices.update', $device->id) }}">
                @csrf
                @method('PUT')
                
                <div class="form-group">
                    <label for="device_name">デバイス名 <span style="color: red;">*</span></label>
                    <input type="text" id="device_name" name="device_name" class="form-control" 
                           value="{{ old('device_name', $device->device_name) }}" required maxlength="255">
                    @error('device_name')
                        <small style="color: red;">{{ $message }}</small>
                    @enderror
                </div>
                
                <div class="form-group">
                    <label for="sigfox_device_id">Sigfox デバイスID <span style="color: red;">*</span></label>
                    <input type="text" id="sigfox_device_id" name="sigfox_device_id" class="form-control" 
                           value="{{ old('sigfox_device_id', $device->sigfox_device_id) }}" required maxlength="8" 
                           style="text-transform: uppercase;">
                    <small style="color: #6b7280;">8桁の英数字ID（例：ABCD1234）</small>
                    @error('sigfox_device_id')
                        <small style="color: red;">{{ $message }}</small>
                    @enderror
                </div>
                
                <div class="form-group">
                    <label for="location">設置場所</label>
                    <input type="text" id="location" name="location" class="form-control" 
                           value="{{ old('location', $device->location) }}" maxlength="255">
                    @error('location')
                        <small style="color: red;">{{ $message }}</small>
                    @enderror
                </div>
                
                <div class="form-group">
                    <label for="description">説明</label>
                    <textarea id="description" name="description" class="form-control" rows="3" maxlength="1000">{{ old('description', $device->description) }}</textarea>
                    @error('description')
                        <small style="color: red;">{{ $message }}</small>
                    @enderror
                </div>
                
                <div class="form-group">
                    <label style="display: flex; align-items: center; gap: 0.5rem;">
                        <input type="checkbox" name="is_active" value="1" 
                               {{ old('is_active', $device->is_active) ? 'checked' : '' }}>
                        アクティブ（データ収集を有効にする）
                    </label>
                    @error('is_active')
                        <small style="color: red;">{{ $message }}</small>
                    @enderror
                </div>
                
                <div style="border-top: 1px solid #e5e7eb; margin: 2rem 0; padding-top: 2rem;">
                    <h3 style="margin-bottom: 1rem;">通知設定</h3>
                    
                    <div class="form-group">
                        <label for="temp_alert_threshold">高温警告しきい値（℃）</label>
                        <input type="number" id="temp_alert_threshold" name="temp_alert_threshold" class="form-control" 
                               value="{{ old('temp_alert_threshold', $device->temp_alert_threshold) }}" 
                               min="-50" max="100" step="0.1">
                        <small style="color: #6b7280;">この温度を超えると緊急アラートメールが送信されます</small>
                        @error('temp_alert_threshold')
                            <small style="color: red;">{{ $message }}</small>
                        @enderror
                    </div>
                    
                    <div class="form-group">
                        <label for="temp_notification_threshold">低温通知しきい値（℃）</label>
                        <input type="number" id="temp_notification_threshold" name="temp_notification_threshold" class="form-control" 
                               value="{{ old('temp_notification_threshold', $device->temp_notification_threshold) }}" 
                               min="-50" max="100" step="0.1">
                        <small style="color: #6b7280;">この温度を下回ると注意喚起メールが送信されます</small>
                        @error('temp_notification_threshold')
                            <small style="color: red;">{{ $message }}</small>
                        @enderror
                    </div>
                </div>
                
                <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <a href="{{ route('devices.index') }}" class="btn" style="background: #6b7280;">キャンセル</a>
                    <button type="submit" class="btn" style="background: #059669; color: white;">更新</button>
                </div>
            </form>
        </div>
    </div>
    
    @if($device->temperatureData()->count() > 0)
    <div class="card" style="margin-top: 2rem;">
        <div class="card-header">
            <h3>関連データ情報</h3>
        </div>
        <div class="card-body">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div class="stat-card">
                    <div class="stat-label">温度データ数</div>
                    <div class="stat-value">{{ number_format($device->temperatureData()->count()) }} 件</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">最初のデータ</div>
                    <div class="stat-value">
                        {{ $device->temperatureData()->oldest()->first()?->created_at?->format('m/d H:i') ?? '-' }}
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">最新のデータ</div>
                    <div class="stat-value">
                        {{ $device->temperatureData()->latest()->first()?->created_at?->format('m/d H:i') ?? '-' }}
                    </div>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
                <p style="margin: 0; color: #92400e;">
                    <strong>⚠️ 注意:</strong> このデバイスを削除すると、{{ number_format($device->temperatureData()->count()) }} 件の温度データも同時に削除されます。
                </p>
            </div>
        </div>
    </div>
    @endif
</div>

<style>
.form-group {
    margin-bottom: 1.5rem;
}

.form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: #374151;
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
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.stat-card {
    background: #f9fafb;
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
}

.stat-label {
    font-size: 0.875rem;
    color: #6b7280;
    margin-bottom: 0.5rem;
}

.stat-value {
    font-size: 1.25rem;
    font-weight: bold;
    color: #111827;
}

.btn {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    color: white;
}

.btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>
@endsection