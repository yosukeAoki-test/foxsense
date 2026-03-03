@extends('layouts.app')

@section('title', $device->device_name . ' - デバイス詳細')

@section('content')
<div class="card">
    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span>{{ $device->device_name }} の詳細</span>
        <a href="{{ route('devices.index') }}" class="btn" style="padding: 0.5rem 1rem;">デバイス一覧へ戻る</a>
    </div>
    <div class="card-body">
        <div class="grid grid-2">
            <!-- デバイス基本情報 -->
            <div>
                <h3 style="margin-bottom: 1rem; font-weight: 600;">デバイス情報</h3>
                <table class="table">
                    <tr>
                        <th style="width: 40%;">Sigfox ID</th>
                        <td>{{ $device->sigfox_device_id }}</td>
                    </tr>
                    <tr>
                        <th>デバイス名</th>
                        <td>{{ $device->device_name }}</td>
                    </tr>
                    <tr>
                        <th>設置場所</th>
                        <td>{{ $device->location ?? '-' }}</td>
                    </tr>
                    <tr>
                        <th>説明</th>
                        <td>{{ $device->description ?? '-' }}</td>
                    </tr>
                    <tr>
                        <th>所有者</th>
                        <td>{{ $device->user->name ?? '-' }}</td>
                    </tr>
                    <tr>
                        <th>状態</th>
                        <td>
                            @if($device->isOnline())
                                <span class="status status-online">オンライン</span>
                            @else
                                <span class="status status-offline">オフライン</span>
                            @endif
                        </td>
                    </tr>
                    <tr>
                        <th>最終受信</th>
                        <td>
                            @if($device->last_seen)
                                {{ $device->last_seen->format('Y/m/d H:i:s') }}
                                <small>({{ $device->last_seen->diffForHumans() }})</small>
                            @else
                                -
                            @endif
                        </td>
                    </tr>
                </table>
            </div>

            <!-- 現在の状態 -->
            <div>
                <h3 style="margin-bottom: 1rem; font-weight: 600;">現在の状態</h3>
                
                <!-- 温度 -->
                <div class="card" style="margin-bottom: 1rem;">
                    <div class="card-body" style="text-align: center;">
                        <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem;">現在の温度</div>
                        <div style="font-size: 3rem; font-weight: bold; color: 
                            @if($device->latest_temperature > 30) #dc2626
                            @elseif($device->latest_temperature < 0) #2563eb
                            @else #059669
                            @endif;">
                            {{ $device->latest_temperature ?? '--' }}°C
                        </div>
                        @if($device->temp_min || $device->temp_max)
                            <div style="font-size: 0.875rem; color: #6b7280;">
                                設定範囲: {{ $device->temp_min ?? '*' }}°C ~ {{ $device->temp_max ?? '*' }}°C
                            </div>
                        @endif
                    </div>
                </div>

                <!-- バッテリー -->
                <div class="card" style="margin-bottom: 1rem;">
                    <div class="card-body">
                        <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem;">バッテリー残量</div>
                        @if($device->battery_level)
                            <div style="display: flex; align-items: center; gap: 1rem;">
                                <div style="flex: 1;">
                                    <div style="height: 30px; border: 2px solid #374151; border-radius: 6px; background: #f3f4f6; position: relative;">
                                        <div style="height: 100%; border-radius: 4px; background: 
                                            @if($device->battery_level >= 75) #059669
                                            @elseif($device->battery_level >= 50) #3b82f6
                                            @elseif($device->battery_level >= 25) #f59e0b
                                            @else #dc2626
                                            @endif; width: {{ $device->battery_level }}%;"></div>
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 1.5rem; font-weight: bold;">{{ $device->battery_level }}%</div>
                                    @if($device->battery_voltage)
                                        <div style="font-size: 0.875rem; color: #6b7280;">{{ $device->battery_voltage }}V</div>
                                    @endif
                                </div>
                            </div>
                            <div style="margin-top: 0.5rem; color: 
                                @if($device->battery_level >= 75) #059669
                                @elseif($device->battery_level >= 50) #3b82f6
                                @elseif($device->battery_level >= 25) #f59e0b
                                @else #dc2626
                                @endif; font-weight: 600;">
                                @if($device->battery_status == 'good') 良好
                                @elseif($device->battery_status == 'normal') 正常
                                @elseif($device->battery_status == 'low') 残量低下
                                @elseif($device->battery_status == 'critical') 要充電
                                @else 不明
                                @endif
                            </div>
                        @else
                            <div style="text-align: center; color: #6b7280; padding: 1rem;">データなし</div>
                        @endif
                    </div>
                </div>
            </div>
        </div>

        <!-- 統計情報 -->
        @if(isset($stats))
        <div class="card" style="margin-top: 2rem;">
            <div class="card-header">統計情報</div>
            <div class="card-body">
                <div class="grid grid-4">
                    <div style="text-align: center;">
                        <div style="font-size: 0.875rem; color: #6b7280;">総データ数</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">{{ $stats['total_data'] ?? 0 }}</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.875rem; color: #6b7280;">平均温度</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">{{ $stats['avg_temp'] ?? '--' }}°C</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.875rem; color: #6b7280;">最高温度</div>
                        <div style="font-size: 1.5rem; font-weight: bold; color: #dc2626;">{{ $stats['max_temp'] ?? '--' }}°C</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.875rem; color: #6b7280;">最低温度</div>
                        <div style="font-size: 1.5rem; font-weight: bold; color: #2563eb;">{{ $stats['min_temp'] ?? '--' }}°C</div>
                    </div>
                </div>
            </div>
        </div>
        @endif

        <!-- 温度グラフ（過去7日間） -->
        <div class="card" style="margin-top: 2rem;">
            <div class="card-header">温度推移グラフ（過去7日間）</div>
            <div class="card-body">
                @if(isset($graphData) && collect($graphData)->sum('count') > 0)
                    @php
                        $allTemps = collect($graphData)->flatMap(function($day) {
                            return $day['data']->pluck('temperature');
                        });
                        $minTemp = $allTemps->min();
                        $maxTemp = $allTemps->max();
                        $tempRange = $maxTemp - $minTemp;
                        $tempRange = $tempRange > 0 ? $tempRange : 10; // 最小範囲10度
                        $graphHeight = 200;
                    @endphp

                    <div style="overflow-x: auto; margin-bottom: 1rem;">
                        <div style="min-width: 800px; height: {{ $graphHeight + 60 }}px; position: relative; background: #f8fafc; border-radius: 8px; padding: 20px;">
                            <!-- Y軸ラベル -->
                            <div style="position: absolute; left: 0; top: 20px; bottom: 40px; width: 50px;">
                                @for($i = 0; $i <= 4; $i++)
                                    @php $tempValue = $minTemp + ($tempRange * $i / 4); @endphp
                                    <div style="position: absolute; top: {{ (1 - $i / 4) * 100 }}%; transform: translateY(-50%); font-size: 0.75rem; color: #6b7280; text-align: right; width: 45px;">
                                        {{ round($tempValue, 1) }}°C
                                    </div>
                                @endfor
                            </div>
                            
                            <!-- グラフエリア -->
                            <div style="margin-left: 55px; height: {{ $graphHeight }}px; position: relative; border-left: 2px solid #e5e7eb; border-bottom: 2px solid #e5e7eb;">
                                <!-- 水平グリッド線 -->
                                @for($i = 1; $i < 4; $i++)
                                    <div style="position: absolute; top: {{ ($i / 4) * 100 }}%; width: 100%; height: 1px; background: #f3f4f6;"></div>
                                @endfor
                                
                                <!-- データポイントと線 -->
                                <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
                                    @php
                                        $dayWidth = 100 / 7; // 7日分のパーセント幅
                                        $previousPoint = null;
                                    @endphp
                                    
                                    @foreach($graphData as $dayIndex => $day)
                                        @if($day['count'] > 0)
                                            @foreach($day['data'] as $dataIndex => $dataPoint)
                                                @php
                                                    $x = ($dayIndex / 7) * 100 + ($dataIndex / max($day['count']-1, 1)) * $dayWidth;
                                                    $y = (1 - ($dataPoint->temperature - $minTemp) / $tempRange) * 100;
                                                    $currentPoint = ['x' => $x, 'y' => $y, 'temp' => $dataPoint->temperature];
                                                @endphp
                                                
                                                <!-- 前のポイントとの線 -->
                                                @if($previousPoint)
                                                    <line x1="{{ $previousPoint['x'] }}%" y1="{{ $previousPoint['y'] }}%" 
                                                          x2="{{ $currentPoint['x'] }}%" y2="{{ $currentPoint['y'] }}%" 
                                                          stroke="#16a34a" stroke-width="2"/>
                                                @endif
                                                
                                                <!-- データポイント -->
                                                <circle cx="{{ $currentPoint['x'] }}%" cy="{{ $currentPoint['y'] }}%" 
                                                       r="4" fill="#16a34a" stroke="white" stroke-width="2">
                                                    <title>{{ $dataPoint->temperature }}°C ({{ $dataPoint->sigfox_time->format('m/d H:i') }})</title>
                                                </circle>
                                                
                                                @php $previousPoint = $currentPoint; @endphp
                                            @endforeach
                                        @endif
                                    @endforeach
                                </svg>
                            </div>
                            
                            <!-- X軸ラベル -->
                            <div style="margin-left: 55px; margin-top: 10px; display: flex; justify-content: space-between;">
                                @foreach($graphData as $day)
                                    <div style="text-align: center; font-size: 0.75rem; color: #6b7280;">
                                        <div>{{ $day['date'] }}</div>
                                        @if($day['count'] > 0)
                                            <div style="font-size: 0.7rem; color: #059669; font-weight: 600;">
                                                {{ $day['avg_temp'] }}°C
                                            </div>
                                        @endif
                                    </div>
                                @endforeach
                            </div>
                        </div>
                    </div>

                    <!-- グラフ統計 -->
                    <div class="grid grid-3" style="gap: 1rem;">
                        <div style="text-align: center; padding: 1rem; background: #f0f9ff; border-radius: 6px;">
                            <div style="font-size: 0.875rem; color: #6b7280;">期間内データ数</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: #16a34a;">{{ collect($graphData)->sum('count') }}</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: #fef2f2; border-radius: 6px;">
                            <div style="font-size: 0.875rem; color: #6b7280;">最高温度</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: #dc2626;">{{ $maxTemp }}°C</div>
                        </div>
                        <div style="text-align: center; padding: 1rem; background: #f0f9ff; border-radius: 6px;">
                            <div style="font-size: 0.875rem; color: #6b7280;">最低温度</div>
                            <div style="font-size: 1.5rem; font-weight: bold; color: #2563eb;">{{ $minTemp }}°C</div>
                        </div>
                    </div>
                @else
                    <p style="text-align: center; color: #6b7280; padding: 2rem;">
                        過去7日間に温度データがありません
                    </p>
                @endif
            </div>
        </div>

        <!-- 最新の温度データ -->
        <div class="card" style="margin-top: 2rem;">
            <div class="card-header">最新の温度データ（直近20件）</div>
            <div class="card-body">
                @if(isset($temperatureData) && $temperatureData->count() > 0)
                    <table class="table">
                        <thead>
                            <tr>
                                <th>測定日時</th>
                                <th>温度</th>
                                <th>バッテリー</th>
                                <th>電波強度</th>
                                <th>アラート</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach($temperatureData as $data)
                            <tr>
                                <td>
                                    {{ $data->sigfox_time ? $data->sigfox_time->format('Y/m/d H:i:s') : '-' }}
                                    <small style="color: #6b7280; display: block;">
                                        {{ $data->sigfox_time ? $data->sigfox_time->diffForHumans() : '' }}
                                    </small>
                                </td>
                                <td>
                                    <span style="font-weight: bold; font-size: 1.125rem; color: 
                                        @if($data->temperature > 30) #dc2626
                                        @elseif($data->temperature < 0) #2563eb
                                        @else #059669
                                        @endif;">
                                        {{ $data->temperature }}°C
                                    </span>
                                </td>
                                <td>
                                    @if($data->battery_level)
                                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                                            <div style="width: 40px; height: 10px; border: 1px solid #6b7280; border-radius: 2px; background: #f3f4f6;">
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
                                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                <rect x="2" y="16" width="4" height="6" fill="{{ $data->rssi >= -105 ? $data->signal_color : '#d1d5db' }}"/>
                                                <rect x="8" y="11" width="4" height="11" fill="{{ $data->rssi >= -95 ? $data->signal_color : '#d1d5db' }}"/>
                                                <rect x="14" y="6" width="4" height="16" fill="{{ $data->rssi >= -85 ? $data->signal_color : '#d1d5db' }}"/>
                                                <rect x="20" y="1" width="4" height="21" fill="{{ $data->rssi >= -75 ? $data->signal_color : '#d1d5db' }}"/>
                                            </svg>
                                            <small>{{ $data->rssi }} dBm</small>
                                        </div>
                                    @else
                                        -
                                    @endif
                                </td>
                                <td>
                                    @if($device->temp_min && $data->temperature < $device->temp_min)
                                        <span class="status" style="background: #fee2e2; color: #991b1b;">低温警告</span>
                                    @elseif($device->temp_max && $data->temperature > $device->temp_max)
                                        <span class="status" style="background: #fee2e2; color: #991b1b;">高温警告</span>
                                    @else
                                        <span class="status status-online">正常</span>
                                    @endif
                                </td>
                            </tr>
                            @endforeach
                        </tbody>
                    </table>
                @else
                    <p style="text-align: center; color: #6b7280; padding: 2rem;">
                        温度データがありません
                    </p>
                @endif
            </div>
        </div>

        <!-- 通知設定 -->
        @if($device->user_id == auth()->id() || auth()->user()->is_admin)
        <div class="card" style="margin-top: 2rem;">
            <div class="card-header">通知設定</div>
            <div class="card-body">
                <form method="POST" action="{{ route('devices.update-thresholds', $device->id) }}">
                    @csrf
                    @method('PUT')
                    
                    <div class="grid grid-2">
                        <div class="form-group">
                            <label for="temp_notification_threshold">低温通知閾値</label>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <input type="number" 
                                       id="temp_notification_threshold" 
                                       name="temp_notification_threshold" 
                                       class="form-control" 
                                       value="{{ $device->temp_notification_threshold ?? '' }}"
                                       min="-50" 
                                       max="100" 
                                       step="0.1"
                                       style="width: 150px;">
                                <span>°C</span>
                            </div>
                            <small style="color: #6b7280;">この温度以下になると通知されます（空欄で通知無効）</small>
                        </div>
                        
                        <div class="form-group">
                            <label for="temp_alert_threshold">高温警告閾値</label>
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <input type="number" 
                                       id="temp_alert_threshold" 
                                       name="temp_alert_threshold" 
                                       class="form-control" 
                                       value="{{ $device->temp_alert_threshold ?? '' }}"
                                       min="-50" 
                                       max="100" 
                                       step="0.1"
                                       style="width: 150px;">
                                <span>°C</span>
                            </div>
                            <small style="color: #6b7280;">この温度以上になると警告通知されます（空欄で通知無効）</small>
                        </div>
                    </div>
                    
                    <div style="margin-top: 1rem;">
                        <button type="submit" class="btn">通知設定を保存</button>
                    </div>
                </form>
                
                <div style="margin-top: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 6px;">
                    <h4 style="margin-bottom: 0.5rem; color: #1e40af;">現在の設定</h4>
                    <ul style="color: #374151; line-height: 1.6; margin: 0;">
                        <li>低温通知: {{ $device->temp_notification_threshold ? $device->temp_notification_threshold . '°C以下' : '無効' }}</li>
                        <li>高温警告: {{ $device->temp_alert_threshold ? $device->temp_alert_threshold . '°C以上' : '無効' }}</li>
                        <li>通知先: {{ auth()->user()->email }} + 追加{{ auth()->user()->userEmails()->count() }}件</li>
                    </ul>
                    @if(auth()->user()->userEmails()->count() == 0)
                        <div style="margin-top: 0.5rem; padding: 0.5rem; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 4px; color: #0c4a6e;">
                            📧 {{ auth()->user()->email }} に通知が送信されます。
                            <a href="{{ route('emails.index') }}" style="color: #0c4a6e; text-decoration: underline;">追加の通知先</a>を設定できます。
                        </div>
                    @endif
                </div>
            </div>
        </div>
        @endif

        <!-- 操作ボタン -->
        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
            <a href="{{ route('temperature-data.index', ['device_id' => $device->id]) }}" class="btn">
                全データを表示
            </a>
            <form method="GET" action="{{ route('temperature-data.export') }}" style="display: inline;">
                <input type="hidden" name="device_id" value="{{ $device->id }}">
                <input type="hidden" name="start_date" value="{{ now()->subMonth()->format('Y-m-d') }}">
                <input type="hidden" name="end_date" value="{{ now()->format('Y-m-d') }}">
                <button type="submit" class="btn btn-success">過去1ヶ月分をCSVエクスポート</button>
            </form>
        </div>
    </div>
</div>
@endsection