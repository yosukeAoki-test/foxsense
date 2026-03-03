@extends('layouts.app')

@section('title', '温度データ - FoxSense One')

@section('content')
<div class="card">
    <div class="card-header">温度データ一覧</div>
    <div class="card-body">
        <!-- フィルタとエクスポート -->
        <div class="grid grid-2" style="margin-bottom: 2rem;">
            <div>
                <form method="GET" action="{{ route('temperature-data.index') }}">
                    <div class="grid grid-2" style="gap: 1rem;">
                        <div class="form-group">
                            <label for="device_id">デバイス</label>
                            <select name="device_id" id="device_id" class="form-control" required>
                                <option value="">デバイスを選択してください</option>
                                @foreach($devices as $device)
                                    <option value="{{ $device->id }}" {{ request('device_id') == $device->id ? 'selected' : '' }}>
                                        {{ $device->device_name }}
                                    </option>
                                @endforeach
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="date_from">開始日</label>
                            <input type="date" name="date_from" id="date_from" class="form-control" value="{{ request('date_from') }}">
                        </div>
                        
                        <div class="form-group">
                            <label for="date_to">終了日</label>
                            <input type="date" name="date_to" id="date_to" class="form-control" value="{{ request('date_to') }}">
                        </div>
                        
                        <div class="form-group" style="display: flex; align-items: end;">
                            <button type="submit" class="btn">フィルタ</button>
                        </div>
                    </div>
                </form>
            </div>
            
            <div>
                <form method="GET" action="{{ route('temperature-data.export') }}">
                    <div class="form-group">
                        <label for="export_device_id">エクスポート対象デバイス</label>
                        <select name="device_id" id="export_device_id" class="form-control" required>
                            <option value="">デバイスを選択してください</option>
                            @foreach($devices as $device)
                                <option value="{{ $device->id }}">{{ $device->device_name }}</option>
                            @endforeach
                        </select>
                    </div>
                    
                    <div class="grid grid-2" style="gap: 1rem;">
                        <div class="form-group">
                            <label for="start_date">開始日 <span style="color: red;">*</span></label>
                            <input type="date" name="start_date" id="start_date" class="form-control" required 
                                   value="{{ date('Y-m-01') }}">
                        </div>
                        
                        <div class="form-group">
                            <label for="end_date">終了日 <span style="color: red;">*</span></label>
                            <input type="date" name="end_date" id="end_date" class="form-control" required 
                                   value="{{ date('Y-m-d') }}">
                        </div>
                    </div>
                    
                    <button type="submit" class="btn btn-success">CSVエクスポート</button>
                </form>
            </div>
        </div>

        <!-- データテーブル -->
        @if($temperatureData->count() > 0)
            <table class="table">
                <thead>
                    <tr>
                        <th>デバイス</th>
                        <th>温度</th>
                        <th>バッテリー</th>
                        <th>電波強度</th>
                        <th>測定日時</th>
                        <th>受信日時</th>
                        <th>場所</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach($temperatureData as $data)
                    <tr>
                        <td>
                            <strong>{{ $data->device->device_name ?? 'Unknown' }}</strong><br>
                            <small style="color: #6b7280;">{{ $data->device->sigfox_device_id ?? '-' }}</small>
                        </td>
                        <td>
                            <span style="font-weight: bold; font-size: 1.125rem; color: 
                                @if($data->temperature > 30) #dc2626
                                @elseif($data->temperature < 0) #2563eb
                                @else #059669 @endif
                            ">{{ $data->temperature }}°C</span>
                        </td>
                        <td>
                            @if($data->battery_level)
                                <div style="display: flex; align-items: center; gap: 0.25rem;">
                                    <div style="width: 40px; height: 12px; border: 1px solid #6b7280; border-radius: 2px; background: #f3f4f6;">
                                        <div style="height: 100%; border-radius: 1px; background: 
                                            @if($data->battery_level >= 75) #059669
                                            @elseif($data->battery_level >= 50) #3b82f6
                                            @elseif($data->battery_level >= 25) #f59e0b
                                            @else #dc2626
                                            @endif; width: {{ $data->battery_level }}%;"></div>
                                    </div>
                                    <small>{{ $data->battery_level }}%</small>
                                </div>
                            @else
                                -
                            @endif
                        </td>
                        <td>
                            @if($data->rssi)
                                <div>
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                            <rect x="2" y="16" width="4" height="6" fill="{{ $data->rssi >= -105 ? $data->signal_color : '#d1d5db' }}"/>
                                            <rect x="8" y="11" width="4" height="11" fill="{{ $data->rssi >= -95 ? $data->signal_color : '#d1d5db' }}"/>
                                            <rect x="14" y="6" width="4" height="16" fill="{{ $data->rssi >= -85 ? $data->signal_color : '#d1d5db' }}"/>
                                            <rect x="20" y="1" width="4" height="21" fill="{{ $data->rssi >= -75 ? $data->signal_color : '#d1d5db' }}"/>
                                        </svg>
                                        <span style="font-size: 0.875rem;">{{ $data->rssi }} dBm</span>
                                    </div>
                                    <small style="color: {{ $data->signal_color }}; font-weight: 600;">
                                        @if($data->signal_quality == 'excellent') 優秀
                                        @elseif($data->signal_quality == 'good') 良好
                                        @elseif($data->signal_quality == 'fair') 普通
                                        @elseif($data->signal_quality == 'poor') 不良
                                        @else 不明
                                        @endif
                                    </small>
                                </div>
                            @else
                                -
                            @endif
                        </td>
                        <td>{{ $data->sigfox_time ? $data->sigfox_time->format('Y/m/d H:i:s') : '-' }}</td>
                        <td>{{ $data->created_at->format('Y/m/d H:i:s') }}</td>
                        <td>{{ $data->device->location ?? '-' }}</td>
                    </tr>
                    @endforeach
                </tbody>
            </table>
            
            <!-- ページネーション -->
            <div style="margin-top: 2rem;">
                {{ $temperatureData->links() }}
            </div>
        @else
            <p style="text-align: center; color: #6b7280; padding: 2rem;">
                指定した条件でデータが見つかりませんでした。
            </p>
        @endif
    </div>
</div>

<style>
/* 簡単なページネーションスタイル */
.pagination {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
}
.pagination a,
.pagination span {
    padding: 0.5rem 1rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    text-decoration: none;
    color: #374151;
}
.pagination a:hover {
    background: #f3f4f6;
}
.pagination .current {
    background: #4f46e5;
    color: white;
    border-color: #4f46e5;
}
</style>
@endsection