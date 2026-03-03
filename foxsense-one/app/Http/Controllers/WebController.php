<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\TemperatureData;
use App\Models\User;
use App\Models\UserEmail;
use App\Services\SigfoxApiService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Carbon\Carbon;

class WebController extends Controller
{
    private SigfoxApiService $sigfoxService;

    public function __construct(SigfoxApiService $sigfoxService)
    {
        $this->sigfoxService = $sigfoxService;
    }

    /**
     * ダッシュボード画面
     */
    public function dashboard()
    {
        $user = auth()->user();
        
        // 管理者の場合は全データ、一般ユーザーは自分のデバイスのみ
        if ($user->is_admin) {
            $stats = [
                'total_devices' => Device::count(),
                'active_devices' => Device::where('is_active', true)->count(),
                'total_data' => TemperatureData::count(),
                'data_today' => TemperatureData::whereDate('created_at', Carbon::now()->setTimezone('Asia/Tokyo')->toDateString())->count(),
                'data_this_week' => TemperatureData::whereBetween('created_at', [
                    Carbon::now()->setTimezone('Asia/Tokyo')->startOfWeek(),
                    Carbon::now()->setTimezone('Asia/Tokyo')->endOfWeek()
                ])->count(),
            ];

            // 最新の温度データ（10件）- 全デバイス
            $recentData = TemperatureData::with('device')
                ->orderBy('sigfox_time', 'desc')
                ->limit(10)
                ->get();

            // デバイス別統計（今月）- アクティブ端末のみ
            $deviceStats = TemperatureData::select('devices.device_name', 'devices.location', DB::raw('count(*) as count'), DB::raw('avg(temperature) as avg_temp'))
                ->join('devices', 'temperature_data.device_id', '=', 'devices.id')
                ->where('devices.is_active', true)
                ->whereMonth('temperature_data.created_at', Carbon::now()->month)
                ->groupBy('devices.id', 'devices.device_name', 'devices.location')
                ->orderBy('count', 'desc')
                ->get();
        } else {
            // 自分のデバイスのみの統計データ（一般ユーザー用）
            $userDeviceIds = Device::where('user_id', $user->id)->pluck('id');
            
            $stats = [
                'total_devices' => Device::where('user_id', $user->id)->count(),
                'active_devices' => Device::where('user_id', $user->id)->where('is_active', true)->count(),
                'total_data' => TemperatureData::whereIn('device_id', $userDeviceIds)->count(),
                'data_today' => TemperatureData::whereIn('device_id', $userDeviceIds)->whereDate('created_at', Carbon::now()->setTimezone('Asia/Tokyo')->toDateString())->count(),
                'data_this_week' => TemperatureData::whereIn('device_id', $userDeviceIds)->whereBetween('created_at', [
                    Carbon::now()->setTimezone('Asia/Tokyo')->startOfWeek(),
                    Carbon::now()->setTimezone('Asia/Tokyo')->endOfWeek()
                ])->count(),
            ];

            // 最新の温度データ（10件）- 自分のデバイスのみ
            $recentData = TemperatureData::with('device')
                ->whereIn('device_id', $userDeviceIds)
                ->orderBy('sigfox_time', 'desc')
                ->limit(10)
                ->get();

            // デバイス別統計（今月）- 自分のアクティブ端末のみ
            $deviceStats = TemperatureData::select('devices.device_name', 'devices.location', DB::raw('count(*) as count'), DB::raw('avg(temperature) as avg_temp'))
                ->join('devices', 'temperature_data.device_id', '=', 'devices.id')
                ->where('devices.user_id', $user->id)
                ->where('devices.is_active', true)
                ->whereMonth('temperature_data.created_at', Carbon::now()->month)
                ->groupBy('devices.id', 'devices.device_name', 'devices.location')
                ->orderBy('count', 'desc')
                ->get();
        }

        // 日別データ数（過去7日）- 最適化されたクエリ
        $startDate = Carbon::now()->setTimezone('Asia/Tokyo')->subDays(6)->startOfDay();
        $endDate = Carbon::now()->setTimezone('Asia/Tokyo')->endOfDay();
        
        $query = TemperatureData::select(DB::raw('DATE(temperature_data.created_at) as date'), DB::raw('COUNT(*) as count'))
            ->join('devices', 'temperature_data.device_id', '=', 'devices.id')
            ->where('devices.is_active', true)
            ->whereBetween('temperature_data.created_at', [$startDate, $endDate]);
            
        if (!$user->is_admin) {
            $query->where('devices.user_id', $user->id);
        }
        
        $dailyDataResults = $query->groupBy(DB::raw('DATE(temperature_data.created_at)'))->get()->keyBy('date');
        
        $dailyData = [];
        for ($i = 6; $i >= 0; $i--) {
            $date = Carbon::now()->setTimezone('Asia/Tokyo')->subDays($i);
            $dateStr = $date->format('Y-m-d');
            $count = $dailyDataResults->has($dateStr) ? $dailyDataResults[$dateStr]->count : 0;
            $dailyData[] = [
                'date' => $date->format('m/d'),
                'count' => $count
            ];
        }

        return view('dashboard', compact(
            'stats', 
            'recentData', 
            'deviceStats', 
            'dailyData'
        ));
    }

    /**
     * デバイス一覧
     */
    public function devices(Request $request)
    {
        $query = Device::with(['user'])
            ->withCount('temperatureData');

        // 一般ユーザーは自分のデバイスのみ、管理者は全デバイス
        if (!auth()->user()->is_admin) {
            $query->where('user_id', auth()->id());
        }

        // 検索機能
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function($q) use ($search) {
                $q->where('device_name', 'like', "%{$search}%")
                  ->orWhere('sigfox_device_id', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%");
            });
        }

        // ステータスフィルタ
        if ($request->filled('status')) {
            if ($request->status === 'active') {
                $query->where('is_active', true);
            } elseif ($request->status === 'inactive') {
                $query->where('is_active', false);
            }
        }

        // ユーザーフィルタ（管理者のみ）
        if (auth()->user()->is_admin && $request->filled('user_id')) {
            $query->where('user_id', $request->user_id);
        }

        $devices = $query->orderBy('created_at', 'desc')->paginate(20);

        // 管理者の場合はユーザー一覧も取得（フィルタ用）
        $users = auth()->user()->is_admin ? User::orderBy('name')->get() : collect();

        return view('devices.index', compact('devices', 'users'));
    }

    /**
     * デバイス詳細
     */
    public function deviceDetail($id)
    {
        $device = Device::with('user')->findOrFail($id);

        // 一般ユーザーは自分のデバイスのみアクセス可能
        if (!auth()->user()->is_admin && $device->user_id !== auth()->id()) {
            abort(403, 'このデバイスにアクセスする権限がありません。');
        }

        // 最新20件の温度データ
        $temperatureData = $device->temperatureData()
            ->orderBy('sigfox_time', 'desc')
            ->limit(20)
            ->get();

        // デバイスの統計
        $stats = [
            'total_data' => $device->temperatureData()->count(),
            'avg_temp' => round($device->temperatureData()->avg('temperature'), 1),
            'max_temp' => round($device->temperatureData()->max('temperature'), 1),
            'min_temp' => round($device->temperatureData()->min('temperature'), 1),
        ];

        // 温度グラフ用データ（過去7日間）
        $graphData = [];
        $now = Carbon::now();
        for ($i = 6; $i >= 0; $i--) {
            $date = $now->copy()->subDays($i);
            $startOfDay = $date->copy()->startOfDay()->timestamp;
            $endOfDay = $date->copy()->endOfDay()->timestamp;
            
            $dayData = $device->temperatureData()
                ->whereBetween('sigfox_time', [$startOfDay, $endOfDay])
                ->orderBy('sigfox_time', 'asc')
                ->get();
            
            $graphData[] = [
                'date' => $date->format('m/d'),
                'full_date' => $date->format('Y-m-d'),
                'data' => $dayData,
                'count' => $dayData->count(),
                'avg_temp' => $dayData->count() > 0 ? round($dayData->avg('temperature'), 1) : 0,
                'max_temp' => $dayData->count() > 0 ? round($dayData->max('temperature'), 1) : 0,
                'min_temp' => $dayData->count() > 0 ? round($dayData->min('temperature'), 1) : 0,
            ];
        }

        // 通知先メールアドレス一覧（自分のデバイスの場合のみ）
        $userEmails = [];
        if (auth()->check() && $device->user_id === auth()->id()) {
            $userEmails = auth()->user()->userEmails()->get();
        }

        return view('devices.detail', compact('device', 'temperatureData', 'stats', 'userEmails', 'graphData'));
    }

    /**
     * 温度データ一覧
     */
    public function temperatureData(Request $request)
    {
        $user = auth()->user();
        $query = TemperatureData::with('device');

        // 一般ユーザーは自分のデバイスのデータのみ
        if (!$user->is_admin) {
            $userDeviceIds = Device::where('user_id', $user->id)->pluck('id');
            $query->whereIn('device_id', $userDeviceIds);
        }

        // フィルタリング
        if ($request->filled('device_id')) {
            $query->where('device_id', $request->device_id);
        }

        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->date_from);
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->date_to);
        }

        if ($request->filled('temp_min')) {
            $query->where('temperature', '>=', $request->temp_min);
        }

        if ($request->filled('temp_max')) {
            $query->where('temperature', '<=', $request->temp_max);
        }

        $temperatureData = $query->orderBy('sigfox_time', 'desc')->paginate(50);

        // フィルタ用データ（一般ユーザーは自分のデバイスのみ）
        if ($user->is_admin) {
            $devices = Device::orderBy('device_name')->get();
        } else {
            $devices = Device::where('user_id', $user->id)->orderBy('device_name')->get();
        }

        return view('temperature-data.index', compact('temperatureData', 'devices'));
    }

    /**
     * 統計画面
     */
    public function statistics(Request $request)
    {
        $user = auth()->user();
        
        // フィルター値の取得
        $deviceId = $request->get('device_id');
        $period = (int) $request->get('period', 30);
        
        // 基本クエリの構築
        $baseQuery = TemperatureData::whereHas('device', function($q) use ($user, $deviceId) {
            $q->where('is_active', true);
            
            // 管理者以外は自分のデバイスのみ
            if (!$user->is_admin) {
                $q->where('user_id', $user->id);
            }
            
            // 特定デバイスが指定されている場合
            if ($deviceId) {
                $q->where('id', $deviceId);
            }
        });
        
        // 期間フィルター（sigfox_timeを使用）
        $startTimestamp = Carbon::now()->subDays($period)->startOfDay()->timestamp;
        $baseQuery->where('sigfox_time', '>=', $startTimestamp);

        // 実際のデータが存在する範囲を取得
        $minDataTime = TemperatureData::whereHas('device', function($q) use ($user, $deviceId) {
            $q->where('is_active', true);
            if (!$user->is_admin) {
                $q->where('user_id', $user->id);
            }
            if ($deviceId) {
                $q->where('id', $deviceId);
            }
        })->min('sigfox_time');
        
        $maxDataTime = TemperatureData::whereHas('device', function($q) use ($user, $deviceId) {
            $q->where('is_active', true);
            if (!$user->is_admin) {
                $q->where('user_id', $user->id);
            }
            if ($deviceId) {
                $q->where('id', $deviceId);
            }
        })->max('sigfox_time');

        // データが存在しない場合は空の統計を返す
        if (!$minDataTime || !$maxDataTime) {
            $dailyStats = [];
            $hourlyStats = [];
            $summaryStats = ['total_count' => 0, 'avg_temp' => 0, 'max_temp' => 0, 'min_temp' => 0];
            $deviceYearlyStats = collect();
            return view('statistics', compact('dailyStats', 'hourlyStats', 'summaryStats', 'deviceYearlyStats'));
        }

        // 実際のデータ範囲に基づいて期間を調整
        $dataStartDate = Carbon::createFromTimestamp($minDataTime);
        $dataEndDate = Carbon::createFromTimestamp($maxDataTime);
        $requestedStartDate = Carbon::now()->subDays($period);
        
        // 実際のデータ開始日と要求された期間の遅い方を開始日とする
        $effectiveStartDate = $dataStartDate->gt($requestedStartDate) ? $dataStartDate : $requestedStartDate;
        
        // 日別統計（実際のデータ範囲内）
        $dailyStats = [];
        $currentDate = $effectiveStartDate->copy()->startOfDay();
        $endDate = $dataEndDate->copy()->startOfDay();
        
        while ($currentDate->lte($endDate)) {
            $startOfDay = $currentDate->copy()->startOfDay()->timestamp;
            $endOfDay = $currentDate->copy()->endOfDay()->timestamp;
            
            // 期間フィルターを適用したクエリを使用
            $countQuery = clone $baseQuery;
            $tempQuery = clone $baseQuery;
            
            $count = $countQuery->whereBetween('sigfox_time', [$startOfDay, $endOfDay])->count();
            $avgTemp = $tempQuery->whereBetween('sigfox_time', [$startOfDay, $endOfDay])->avg('temperature');
            
            $dailyStats[] = [
                'date' => $currentDate->format('m/d'),
                'count' => $count,
                'avg_temp' => round($avgTemp, 1) ?: 0
            ];
            
            $currentDate->addDay();
        }

        // 時間別統計（24時間）
        $hourlyStats = [];
        $dbDriver = DB::connection()->getDriverName();
        
        for ($hour = 0; $hour < 24; $hour++) {
            $query = clone $baseQuery;
            
            if ($dbDriver === 'sqlite') {
                // SQLiteではdatetimeで時間を抽出
                $query->whereRaw("strftime('%H', datetime(sigfox_time, 'unixepoch')) = ?", [sprintf('%02d', $hour)]);
            } else {
                // MySQLではFROM_UNIXTIMEを使用
                $query->whereRaw("HOUR(FROM_UNIXTIME(sigfox_time)) = ?", [$hour]);
            }
            
            $count = $query->count();
            $avgTemp = $query->avg('temperature');
            
            $hourlyStats[] = [
                'hour' => sprintf('%02d:00', $hour),
                'count' => $count,
                'avg_temp' => round($avgTemp, 1) ?: 0
            ];
        }

        // サマリー統計
        $totalCount = (clone $baseQuery)->count();
        $avgTemp = (clone $baseQuery)->avg('temperature');
        $maxTemp = (clone $baseQuery)->max('temperature');
        $minTemp = (clone $baseQuery)->min('temperature');
        
        $summaryStats = [
            'total_count' => $totalCount,
            'avg_temp' => round($avgTemp, 1),
            'max_temp' => round($maxTemp, 1),
            'min_temp' => round($minTemp, 1),
        ];

        // デバイス別年間統計
        $deviceYearlyStats = collect();
        $yearStart = Carbon::now()->startOfYear()->timestamp;
        $yearEnd = Carbon::now()->endOfYear()->timestamp;
        
        if ($user->is_admin) {
            $deviceYearlyStats = TemperatureData::select(
                'devices.device_name',
                'devices.location',
                DB::raw('count(*) as count'),
                DB::raw('avg(temperature) as avg_temp'),
                DB::raw('max(temperature) as max_temp'),
                DB::raw('min(temperature) as min_temp')
            )
            ->join('devices', 'temperature_data.device_id', '=', 'devices.id')
            ->whereBetween('temperature_data.sigfox_time', [$yearStart, $yearEnd])
            ->where('devices.is_active', true)
            ->groupBy('devices.id', 'devices.device_name', 'devices.location')
            ->orderBy('count', 'desc')
            ->get();
        } else {
            // 一般ユーザーは自分のデバイスのみ
            $deviceYearlyStats = TemperatureData::select(
                'devices.device_name',
                'devices.location',
                DB::raw('count(*) as count'),
                DB::raw('avg(temperature) as avg_temp'),
                DB::raw('max(temperature) as max_temp'),
                DB::raw('min(temperature) as min_temp')
            )
            ->join('devices', 'temperature_data.device_id', '=', 'devices.id')
            ->where('devices.user_id', $user->id)
            ->whereBetween('temperature_data.sigfox_time', [$yearStart, $yearEnd])
            ->where('devices.is_active', true)
            ->groupBy('devices.id', 'devices.device_name', 'devices.location')
            ->orderBy('count', 'desc')
            ->get();
        }

        return view('statistics', compact(
            'dailyStats',
            'hourlyStats', 
            'summaryStats',
            'deviceYearlyStats'
        ));
    }

    /**
     * デバイス登録
     */
    public function storeDevice(Request $request)
    {
        $request->validate([
            'sigfox_id' => 'required|string|unique:devices,sigfox_device_id|max:8',
            'name' => 'required|string|max:255',
            'location' => 'nullable|string|max:255',
        ]);

        $device = Device::create([
            'sigfox_device_id' => strtoupper($request->sigfox_id),
            'device_name' => $request->name,
            'location' => $request->location,
            'user_id' => auth()->id(),
            'is_active' => true,
        ]);

        return redirect()->route('devices.index')->with('success', 'デバイスを登録しました。');
    }

    /**
     * 温度データのCSVエクスポート
     */
    public function exportTemperatureData(Request $request)
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'device_id' => 'nullable|integer|exists:devices,id',
        ]);

        $user = auth()->user();
        
        // 日付をタイムスタンプに変換
        $startTimestamp = \Carbon\Carbon::parse($request->start_date)->startOfDay()->timestamp;
        $endTimestamp = \Carbon\Carbon::parse($request->end_date)->endOfDay()->timestamp;
        
        $query = TemperatureData::with('device')
            ->whereBetween('sigfox_time', [$startTimestamp, $endTimestamp]);

        // 管理者以外は自分のデバイスのみ
        if (!$user->is_admin) {
            $query->whereHas('device', function($q) use ($user) {
                $q->where('user_id', $user->id);
            });
        }

        // 特定デバイスが指定されている場合
        if ($request->device_id) {
            $query->where('device_id', $request->device_id);
        }

        $data = $query->orderBy('sigfox_time', 'desc')->get();

        $filename = 'temperature_data_' . $request->start_date . '_' . $request->end_date . '.csv';

        $headers = [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ];

        $callback = function() use ($data) {
            $file = fopen('php://output', 'w');
            
            // BOMを追加（Excel対応）
            fwrite($file, "\xEF\xBB\xBF");
            
            // ヘッダー
            fputcsv($file, [
                'デバイス名',
                'Sigfox ID',
                '温度 (°C)',
                'バッテリー残量 (%)',
                'バッテリー電圧 (V)',
                'RSSI (dBm)',
                '基地局RSSI (dBm)',
                'SNR',
                '測定日時',
                '受信日時',
                '場所',
            ]);

            // データ
            foreach ($data as $row) {
                fputcsv($file, [
                    $row->device->device_name ?? '',
                    $row->device->sigfox_device_id ?? '',
                    $row->temperature,
                    $row->battery_level ?? '',
                    $row->battery_voltage ?? '',
                    $row->rssi ?? '',
                    $row->station_rssi ?? '',
                    $row->snr ?? '',
                    $row->sigfox_time ? $row->sigfox_time->format('Y-m-d H:i:s') : '',
                    $row->created_at->format('Y-m-d H:i:s'),
                    $row->device->location ?? '',
                ]);
            }

            fclose($file);
        };

        return response()->stream($callback, 200, $headers);
    }

    /**
     * Sigfoxデータ同期実行
     */
    public function syncSigfoxData()
    {
        // 管理者のみ実行可能
        if (!auth()->user()->is_admin) {
            abort(403, 'データ同期を実行する権限がありません。');
        }

        try {
            $syncedCount = $this->sigfoxService->syncAllDevices();
            
            return redirect()->back()
                ->with('success', "Sigfoxデータを同期しました。新規取得: {$syncedCount}件");
        } catch (\Exception $e) {
            return redirect()->back()
                ->with('error', "データ同期に失敗しました: " . $e->getMessage());
        }
    }

    /**
     * ユーザー設定画面
     */
    public function settings()
    {
        $user = Auth::user();
        
        // システム統計データ（一般ユーザーは自分のデータのみ）
        if ($user->is_admin) {
            $totalUsers = User::count();
            $totalDevices = Device::count();
        } else {
            $totalUsers = 1; // 自分のみ
            $totalDevices = Device::where('user_id', $user->id)->count();
        }
        
        return view('settings', compact('totalUsers', 'totalDevices'));
    }

    /**
     * ユーザー設定更新
     */
    public function updateSettings(Request $request)
    {
        // 現在はデバイス固有の設定のみなので、特に更新処理はなし
        return redirect()->route('settings')
            ->with('info', '設定は各デバイスの詳細画面から行ってください。');
    }

    /**
     * 通知先メールアドレス一覧
     */
    public function emails()
    {
        $emails = UserEmail::where('user_id', auth()->id())
            ->orderBy('created_at', 'desc')
            ->get();

        return view('emails.index', compact('emails'));
    }

    /**
     * 通知先メールアドレス追加
     */
    public function storeEmail(Request $request)
    {
        $request->validate([
            'email' => 'required|email|max:255',
        ]);

        // 重複チェック
        $exists = UserEmail::where('user_id', auth()->id())
            ->where('email', $request->email)
            ->exists();

        if ($exists) {
            return redirect()->route('emails.index')
                ->with('error', 'このメールアドレスは既に登録されています。');
        }

        $userEmail = UserEmail::create([
            'user_id' => auth()->id(),
            'email' => $request->email,
        ]);

        // テストメール送信
        $testEmailSent = $this->sendTestEmail($request->email, auth()->user());

        if ($testEmailSent) {
            return redirect()->route('emails.index')
                ->with('success', 'メールアドレスを追加しました。テストメールを送信しました。');
        } else {
            return redirect()->route('emails.index')
                ->with('warning', 'メールアドレスは追加されましたが、テストメールの送信に失敗しました。');
        }
    }

    /**
     * 通知先メールアドレス削除
     */
    public function destroyEmail(UserEmail $email)
    {
        // 自分のメールアドレスのみ削除可能
        if ($email->user_id !== auth()->id()) {
            abort(403, 'このメールアドレスを削除する権限がありません。');
        }

        $email->delete();

        return redirect()->route('emails.index')
            ->with('success', 'メールアドレスを削除しました。');
    }

    /**
     * テストメール送信（手動実行）
     */
    public function testEmail(UserEmail $email)
    {
        // 自分のメールアドレスのみテスト可能
        if ($email->user_id !== auth()->id()) {
            abort(403, 'このメールアドレスをテストする権限がありません。');
        }

        $testEmailSent = $this->sendTestEmail($email->email, auth()->user());

        if ($testEmailSent) {
            return redirect()->route('emails.index')
                ->with('success', "テストメールを {$email->email} に送信しました。");
        } else {
            return redirect()->route('emails.index')
                ->with('error', 'テストメールの送信に失敗しました。');
        }
    }

    /**
     * デバイス通知閾値更新
     */
    public function updateDeviceThresholds(Request $request, $id)
    {
        $device = Device::findOrFail($id);

        // デバイスの所有者または管理者のみ更新可能
        if (!auth()->user()->is_admin && $device->user_id !== auth()->id()) {
            abort(403, 'このデバイスの設定を変更する権限がありません。');
        }

        $request->validate([
            'temp_notification_threshold' => 'nullable|numeric|min:-50|max:100',
            'temp_alert_threshold' => 'nullable|numeric|min:-50|max:100',
        ]);

        // 両方の値が設定されている場合、低温通知 <= 高温警告の関係をチェック
        if ($request->filled('temp_notification_threshold') && $request->filled('temp_alert_threshold')) {
            $request->validate([
                'temp_alert_threshold' => 'gte:temp_notification_threshold',
            ], [
                'temp_alert_threshold.gte' => '高温警告閾値は低温通知閾値以上である必要があります。',
            ]);
        }

        $device->update([
            'temp_notification_threshold' => $request->temp_notification_threshold,
            'temp_alert_threshold' => $request->temp_alert_threshold,
        ]);

        return redirect()->route('devices.detail', $device->id)
            ->with('success', 'デバイスの通知設定を更新しました。');
    }

    /**
     * テストメール送信
     */
    private function sendTestEmail(string $email, $user): bool
    {
        try {
            Mail::send('emails.test_notification', [
                'user' => $user,
                'email' => $email,
            ], function ($message) use ($email, $user) {
                $message->to($email)
                    ->subject("FoxSense One - メール通知テスト ({$user->name}様)");
            });

            Log::info('Test notification email sent', [
                'user_id' => $user->id,
                'email' => $email
            ]);

            return true;
        } catch (\Exception $e) {
            Log::error('Failed to send test notification email', [
                'user_id' => $user->id,
                'email' => $email,
                'error' => $e->getMessage()
            ]);

            return false;
        }
    }

    /**
     * デバイス編集フォーム表示
     */
    public function editDevice(Request $request, $id)
    {
        $device = Device::findOrFail($id);
        
        // 権限チェック: 管理者または自分のデバイスのみ
        if (!auth()->user()->is_admin && $device->user_id !== auth()->id()) {
            abort(403, '他のユーザーのデバイスは編集できません');
        }

        return view('devices.edit', compact('device'));
    }

    /**
     * デバイス情報更新
     */
    public function updateDevice(Request $request, $id)
    {
        $device = Device::findOrFail($id);
        
        // 権限チェック: 管理者または自分のデバイスのみ
        if (!auth()->user()->is_admin && $device->user_id !== auth()->id()) {
            abort(403, '他のユーザーのデバイスは編集できません');
        }

        $validated = $request->validate([
            'device_name' => 'required|string|max:255',
            'sigfox_device_id' => 'required|string|max:8|unique:devices,sigfox_device_id,' . $id,
            'location' => 'nullable|string|max:255',
            'is_active' => 'boolean',
            'temp_alert_threshold' => 'nullable|numeric|min:-50|max:100',
            'temp_notification_threshold' => 'nullable|numeric|min:-50|max:100',
        ]);

        $device->update($validated);

        return redirect()->route('devices.index')
            ->with('success', 'デバイス情報を更新しました。');
    }

    /**
     * デバイス削除
     */
    public function deleteDevice(Request $request, $id)
    {
        $device = Device::findOrFail($id);
        
        // 権限チェック: 管理者または自分のデバイスのみ
        if (!auth()->user()->is_admin && $device->user_id !== auth()->id()) {
            abort(403, '他のユーザーのデバイスは削除できません');
        }

        // 関連データも削除されることを警告
        $temperatureDataCount = $device->temperatureData()->count();
        
        if ($temperatureDataCount > 0) {
            // 確認フラグがない場合は確認を求める
            if (!$request->has('confirm')) {
                return redirect()->back()
                    ->with('warning', "「{$device->device_name}」には{$temperatureDataCount}件の温度データが関連付けられています。削除すると全てのデータが失われます。本当に削除しますか？")
                    ->with('delete_device_id', $id);
            }
        }

        $deviceName = $device->device_name;
        $device->delete(); // 関連するtemperature_dataも自動削除（外部キー制約）

        return redirect()->route('devices.index')
            ->with('success', "デバイス「{$deviceName}」を削除しました。");
    }

    /**
     * 管理者用ユーザー一覧
     */
    public function adminUsers(Request $request)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'ユーザー管理にアクセスする権限がありません。');
        }

        $query = User::with(['devices' => function($q) {
            $q->withCount('temperatureData');
        }])->withCount(['devices', 'userEmails']);

        // 検索機能
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        // 管理者フィルタ
        if ($request->filled('admin_filter')) {
            if ($request->admin_filter === 'admin') {
                $query->where('is_admin', true);
            } elseif ($request->admin_filter === 'user') {
                $query->where('is_admin', false);
            }
        }

        $users = $query->orderBy('created_at', 'desc')->paginate(20);

        return view('admin.users.index', compact('users'));
    }

    /**
     * 管理者用ユーザー編集フォーム
     */
    public function editUser($id)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'ユーザー編集にアクセスする権限がありません。');
        }

        $user = User::with(['devices' => function($q) {
            $q->withCount('temperatureData')
              ->with('latestTemperatureData');
        }])->withCount(['devices', 'userEmails'])->findOrFail($id);
        
        // 自分自身の管理者権限は削除できないようにする
        $canChangeAdminStatus = $user->id !== auth()->id();

        return view('admin.users.edit', compact('user', 'canChangeAdminStatus'));
    }

    /**
     * 管理者用ユーザー情報更新
     */
    public function updateUser(Request $request, $id)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'ユーザー情報を更新する権限がありません。');
        }

        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email,' . $id,
            'is_admin' => 'boolean',
            'new_password' => 'nullable|string|min:8|confirmed|regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/',
            'new_password_confirmation' => 'nullable|string',
        ]);

        // 自分自身の管理者権限は削除できない
        if ($user->id === auth()->id() && isset($validated['is_admin']) && !$validated['is_admin']) {
            return redirect()->back()
                ->with('error', '自分自身の管理者権限は削除できません。');
        }

        // パスワード変更処理（管理者権限により現在のパスワード確認なし）
        if ($request->filled('new_password')) {
            $validated['password'] = Hash::make($request->new_password);
        }

        // パスワード変更関連のフィールドを除外
        $updateData = collect($validated)->except(['new_password', 'new_password_confirmation'])->toArray();
        
        $user->update($updateData);

        // 成功メッセージを組み立て
        $successMessage = "ユーザー「{$user->name}」の情報を更新しました。";
        if ($request->filled('new_password')) {
            $successMessage .= ' パスワードも変更されました。';
        }

        return redirect()->route('admin.users')
            ->with('success', $successMessage);
    }


    /**
     * 管理者用ユーザー削除
     */
    public function deleteUser(Request $request, $id)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'ユーザーを削除する権限がありません。');
        }

        $user = User::findOrFail($id);
        
        // 自分自身は削除できない
        if ($user->id === auth()->id()) {
            return redirect()->back()
                ->with('error', '自分自身のアカウントは削除できません。');
        }

        // 関連データの確認
        $deviceCount = $user->devices()->count();
        $emailCount = $user->userEmails()->count();
        
        if ($deviceCount > 0 || $emailCount > 0) {
            // 確認フラグがない場合は確認を求める
            if (!$request->has('confirm')) {
                $message = "「{$user->name}」には";
                if ($deviceCount > 0) {
                    $message .= "{$deviceCount}件のデバイス";
                }
                if ($emailCount > 0) {
                    if ($deviceCount > 0) $message .= "と";
                    $message .= "{$emailCount}件のメールアドレス";
                }
                $message .= "が関連付けられています。削除すると全てのデータが失われます。本当に削除しますか？";
                
                return redirect()->back()
                    ->with('warning', $message)
                    ->with('delete_user_id', $id);
            }
        }

        $userName = $user->name;
        $user->delete(); // 関連データも自動削除（外部キー制約）

        return redirect()->route('admin.users')
            ->with('success', "ユーザー「{$userName}」を削除しました。");
    }

    /**
     * デバイスのデータのみを削除（デバイス自体は残す）
     */
    public function deleteDeviceData(Request $request, $id)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'デバイスデータを削除する権限がありません。');
        }

        $device = Device::findOrFail($id);
        
        // データ数を取得
        $dataCount = $device->temperatureData()->count();
        
        if ($dataCount > 0) {
            // 確認フラグがない場合は確認を求める
            if (!$request->has('confirm')) {
                return redirect()->back()
                    ->with('warning', "デバイス「{$device->device_name}」の{$dataCount}件の温度データを削除しますか？この操作は取り消せません。")
                    ->with('delete_device_data_id', $id);
            }
            
            // データを削除
            $device->temperatureData()->delete();
            
            return redirect()->back()
                ->with('success', "デバイス「{$device->device_name}」の{$dataCount}件のデータを削除しました。");
        }
        
        return redirect()->back()
            ->with('info', "デバイス「{$device->device_name}」には削除するデータがありません。");
    }


    /**
     * 管理者画面から特定デバイスを削除
     */
    public function adminDeleteDevice(Request $request, $id)
    {
        // 管理者のみアクセス可能
        if (!auth()->user()->is_admin) {
            abort(403, 'デバイスを削除する権限がありません。');
        }

        $device = Device::findOrFail($id);
        
        // 関連データも削除されることを警告
        $temperatureDataCount = $device->temperatureData()->count();
        
        if ($temperatureDataCount > 0) {
            // 確認フラグがない場合は確認を求める
            if (!$request->has('confirm')) {
                return redirect()->back()
                    ->with('warning', "デバイス「{$device->device_name}」と{$temperatureDataCount}件の温度データを削除しますか？")
                    ->with('admin_delete_device_id', $id);
            }
        }

        $deviceName = $device->device_name;
        $device->delete(); // 関連するtemperature_dataも自動削除（外部キー制約）

        return redirect()->back()
            ->with('success', "デバイス「{$deviceName}」を削除しました。");
    }
}