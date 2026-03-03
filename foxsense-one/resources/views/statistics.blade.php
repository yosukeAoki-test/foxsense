@extends('layouts.app')

@section('title', '統計 - FoxSense One')

@section('content')
<!-- フィルター設定 -->
<div class="card" style="margin-bottom: 2rem;">
    <div class="card-header">統計フィルター</div>
    <div class="card-body">
        <form method="GET" action="{{ route('statistics') }}">
            <div class="grid grid-3">
                <div class="form-group">
                    <label for="device_id">デバイス</label>
                    <select name="device_id" id="device_id" class="form-control">
                        <option value="">デバイスを選択してください</option>
                        @php
                            $user = auth()->user();
                            $availableDevices = $user->is_admin ? 
                                \App\Models\Device::orderBy('device_name')->get() :
                                \App\Models\Device::where('user_id', $user->id)->orderBy('device_name')->get();
                        @endphp
                        @foreach($availableDevices as $device)
                            <option value="{{ $device->id }}" {{ request('device_id') == $device->id ? 'selected' : '' }}>
                                {{ $device->device_name }}
                            </option>
                        @endforeach
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="period">期間</label>
                    <select name="period" id="period" class="form-control">
                        <option value="7" {{ request('period', '30') == '7' ? 'selected' : '' }}>過去7日間</option>
                        <option value="30" {{ request('period', '30') == '30' ? 'selected' : '' }}>過去30日間</option>
                        <option value="90" {{ request('period', '30') == '90' ? 'selected' : '' }}>過去90日間</option>
                        <option value="365" {{ request('period', '30') == '365' ? 'selected' : '' }}>過去1年間</option>
                    </select>
                </div>
                
                <div class="form-group" style="display: flex; align-items: end;">
                    <button type="submit" class="btn">統計を表示</button>
                </div>
            </div>
        </form>
    </div>
</div>

<div class="card">
    <div class="card-header">
        統計情報
        @if(request('device_id'))
            @php
                $selectedDevice = \App\Models\Device::find(request('device_id'));
            @endphp
            - {{ $selectedDevice->device_name ?? '' }}
        @endif
        （過去{{ request('period', 30) }}日間）
    </div>
    <div class="card-body">
        <!-- サマリー統計 -->
        @if(isset($summaryStats))
        <div class="grid grid-4" style="margin-bottom: 2rem;">
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">総データ数</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #16a34a;">{{ number_format($summaryStats['total_count']) }}</div>
                </div>
            </div>
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">平均温度</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #059669;">{{ $summaryStats['avg_temp'] }}°C</div>
                </div>
            </div>
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">最高温度</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #dc2626;">{{ $summaryStats['max_temp'] }}°C</div>
                </div>
            </div>
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">最低温度</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #2563eb;">{{ $summaryStats['min_temp'] }}°C</div>
                </div>
            </div>
        </div>
        @endif

        <!-- デバッグ情報 -->
        <div class="card" style="margin-bottom: 1rem; background: #fef2f2; border: 1px solid #fecaca;">
            <div class="card-header" style="background: #fee2e2;">デバッグ情報（一時的表示）</div>
            <div class="card-body">
                <small>
                    日別統計データ数: {{ count($dailyStats ?? []) }}<br>
                    時間別統計データ数: {{ count($hourlyStats ?? []) }}<br>
                    サマリー統計: {{ isset($summaryStats) ? 'あり' : 'なし' }}<br>
                    デバイス年間統計数: {{ isset($deviceYearlyStats) ? $deviceYearlyStats->count() : 0 }}<br>
                    @if(isset($dailyStats) && count($dailyStats) > 0)
                        最初の日のデータ: {{ $dailyStats[0]['date'] ?? 'なし' }} - {{ $dailyStats[0]['count'] ?? 0 }}件<br>
                        最後の日のデータ: {{ end($dailyStats)['date'] ?? 'なし' }} - {{ end($dailyStats)['count'] ?? 0 }}件
                    @endif
                </small>
            </div>
        </div>

        <!-- 日別統計グラフ -->
        <div class="card" style="margin-bottom: 2rem;">
            <div class="card-header">日別データ数と平均温度</div>
            <div class="card-body">
                <div style="overflow-x: auto;">
                    <div style="min-width: 800px; height: 300px; position: relative;">
                        @if(isset($dailyStats) && count($dailyStats) > 0)
                            @php
                                $maxCount = max(array_column($dailyStats, 'count'));
                                $maxCount = max($maxCount, 1);
                            @endphp
                            
                            <!-- グラフデバッグ情報 -->
                            <div style="margin-bottom: 1rem; padding: 0.5rem; background: #f3f4f6; border-radius: 4px; font-size: 0.8rem;">
                                最大データ数: {{ $maxCount }}件 | 表示期間: {{ count($dailyStats) }}日間
                            </div>
                            
                            <div style="display: flex; height: 250px; align-items: flex-end; gap: 4px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
                                @foreach($dailyStats as $stat)
                                <div style="flex: 1; position: relative; min-width: 40px;">
                                    @php
                                        $barHeight = $stat['count'] > 0 ? max(($stat['count'] / $maxCount) * 100, 3) : 0;
                                    @endphp
                                    <div style="position: relative; height: 100%; display: flex; flex-direction: column; justify-content: flex-end;">
                                        <!-- データ数バー -->
                                        @if($stat['count'] > 0)
                                        <div style="background: linear-gradient(180deg, #22c55e, #16a34a); 
                                                    width: 100%; 
                                                    height: {{ $barHeight }}%; 
                                                    border-radius: 4px 4px 0 0; 
                                                    position: relative;
                                                    box-shadow: 0 2px 4px rgba(34, 197, 94, 0.2);
                                                    border: 1px solid #16a34a;">
                                            <span style="position: absolute; top: -25px; left: 50%; transform: translateX(-50%); 
                                                         font-size: 0.7rem; font-weight: 600; color: #16a34a; white-space: nowrap;">
                                                {{ $stat['count'] }}
                                            </span>
                                        </div>
                                        @else
                                        <div style="background: #e5e7eb; width: 100%; height: 2px; border-radius: 1px;"></div>
                                        @endif
                                    </div>
                                    <!-- 日付と平均温度 -->
                                    <div style="text-align: center; margin-top: 0.75rem;">
                                        <div style="font-size: 0.7rem; font-weight: 600;">{{ $stat['date'] }}</div>
                                        @if($stat['avg_temp'] > 0)
                                        <div style="font-size: 0.75rem; font-weight: 600; color: #dc2626;">
                                            {{ $stat['avg_temp'] }}°C
                                        </div>
                                        @endif
                                    </div>
                                </div>
                                @endforeach
                            </div>
                        @else
                            <p style="text-align: center; color: #6b7280;">データがありません</p>
                        @endif
                    </div>
                </div>
            </div>
        </div>

        <!-- 時間別統計 -->
        <div class="card" style="margin-bottom: 2rem;">
            <div class="card-header">時間別データ分布（24時間）</div>
            <div class="card-body">
                <div style="overflow-x: auto;">
                    <div style="min-width: 800px;">
                        @if(isset($hourlyStats) && count($hourlyStats) > 0)
                            @php
                                $maxHourCount = max(array_column($hourlyStats, 'count'));
                                $maxHourCount = max($maxHourCount, 1);
                            @endphp
                            <div style="display: flex; height: 200px; align-items: flex-end; gap: 1px; border-bottom: 2px solid #e5e7eb; padding-bottom: 5px;">
                                @foreach($hourlyStats as $stat)
                                <div style="flex: 1; position: relative; min-width: 20px;">
                                    @php
                                        $barHeight = $stat['count'] > 0 ? max(($stat['count'] / $maxHourCount) * 100, 2) : 0;
                                        $isDaytime = $stat['hour'] >= '06:00' && $stat['hour'] < '18:00';
                                        $barColor = $isDaytime ? '#f59e0b' : '#1e40af';
                                    @endphp
                                    @if($stat['count'] > 0)
                                    <div style="background: {{ $barColor }}; 
                                                width: 100%; 
                                                height: {{ $barHeight }}%; 
                                                border-radius: 2px 2px 0 0;
                                                position: relative;
                                                box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                        <span style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); 
                                                     font-size: 0.6rem; font-weight: 600; color: {{ $barColor }}; white-space: nowrap;">
                                            {{ $stat['count'] }}
                                        </span>
                                    </div>
                                    @else
                                    <div style="background: #e5e7eb; width: 100%; height: 1px; border-radius: 1px;"></div>
                                    @endif
                                    <div style="text-align: center; margin-top: 0.25rem; font-size: 0.6rem; font-weight: 600;">
                                        {{ substr($stat['hour'], 0, 2) }}
                                    </div>
                                </div>
                                @endforeach
                            </div>
                            <div style="margin-top: 0.5rem; display: flex; gap: 1rem; justify-content: center;">
                                <span style="display: flex; align-items: center; gap: 0.25rem;">
                                    <span style="width: 12px; height: 12px; background: #f59e0b; border-radius: 2px;"></span>
                                    <small>日中（6:00-18:00）</small>
                                </span>
                                <span style="display: flex; align-items: center; gap: 0.25rem;">
                                    <span style="width: 12px; height: 12px; background: #1e40af; border-radius: 2px;"></span>
                                    <small>夜間（18:00-6:00）</small>
                                </span>
                            </div>
                        @else
                            <p style="text-align: center; color: #6b7280;">データがありません</p>
                        @endif
                    </div>
                </div>
            </div>
        </div>

        <!-- デバイス別年間統計 -->
        <div class="card">
            <div class="card-header">デバイス別年間統計（{{ date('Y') }}年）</div>
            <div class="card-body">
                @if(isset($deviceYearlyStats) && $deviceYearlyStats->count() > 0)
                    <table class="table">
                        <thead>
                            <tr>
                                <th>デバイス名</th>
                                <th>設置場所</th>
                                <th>データ数</th>
                                <th>平均温度</th>
                                <th>最高温度</th>
                                <th>最低温度</th>
                                <th>温度範囲</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach($deviceYearlyStats as $stat)
                            <tr>
                                <td>{{ $stat->device_name }}</td>
                                <td>{{ $stat->location ?? '-' }}</td>
                                <td>
                                    <strong>{{ number_format($stat->count) }}</strong>
                                </td>
                                <td>
                                    <span style="font-weight: 600;">
                                        {{ number_format($stat->avg_temp, 1) }}°C
                                    </span>
                                </td>
                                <td>
                                    <span style="color: #dc2626; font-weight: 600;">
                                        {{ number_format($stat->max_temp, 1) }}°C
                                    </span>
                                </td>
                                <td>
                                    <span style="color: #2563eb; font-weight: 600;">
                                        {{ number_format($stat->min_temp, 1) }}°C
                                    </span>
                                </td>
                                <td>
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        @php
                                            $range = $stat->max_temp - $stat->min_temp;
                                            $normalizedMin = max(0, min(100, ($stat->min_temp + 20) * 2));
                                            $normalizedMax = max(0, min(100, ($stat->max_temp + 20) * 2));
                                            $width = $normalizedMax - $normalizedMin;
                                        @endphp
                                        <div style="width: 100px; height: 20px; background: #e5e7eb; border-radius: 4px; position: relative;">
                                            <div style="position: absolute; 
                                                left: {{ $normalizedMin }}%; 
                                                width: {{ $width }}%; 
                                                height: 100%; 
                                                background: linear-gradient(90deg, #2563eb, #059669, #dc2626); 
                                                border-radius: 4px;">
                                            </div>
                                        </div>
                                        <small>{{ number_format($range, 1) }}°C</small>
                                    </div>
                                </td>
                            </tr>
                            @endforeach
                        </tbody>
                    </table>
                @else
                    <p style="text-align: center; color: #6b7280; padding: 2rem;">
                        デバイスデータがありません
                    </p>
                @endif
            </div>
        </div>

        <!-- サマリー -->
        @if(auth()->user()->is_admin)
        <div class="grid grid-3" style="margin-top: 2rem;">
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">総デバイス数</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #4f46e5;">
                        {{ \App\Models\Device::count() }}
                    </div>
                </div>
            </div>
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">総データ数</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #059669;">
                        {{ number_format(\App\Models\TemperatureData::count()) }}
                    </div>
                </div>
            </div>
            <div class="card">
                <div class="card-body" style="text-align: center;">
                    <div style="font-size: 0.875rem; color: #6b7280;">アクティブユーザー</div>
                    <div style="font-size: 2rem; font-weight: bold; color: #dc2626;">
                        {{ \App\Models\User::count() }}
                    </div>
                </div>
            </div>
        </div>
        @endif
    </div>
</div>
@endsection