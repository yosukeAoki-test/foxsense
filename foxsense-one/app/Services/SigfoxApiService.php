<?php

namespace App\Services;

use App\Models\Device;
use App\Models\TemperatureData;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Carbon\Carbon;

class SigfoxApiService
{
    private string $baseUrl = 'https://backend.sigfox.com/api';
    private string $username;
    private string $password;

    public function __construct()
    {
        $this->username = config('services.sigfox.username', '');
        $this->password = config('services.sigfox.password', '');
    }

    /**
     * 指定デバイスの最新データを取得
     */
    public function getDeviceMessages(string $deviceId, int $limit = 100): ?array
    {
        try {
            $response = Http::withBasicAuth($this->username, $this->password)
                ->timeout(30)
                ->get("{$this->baseUrl}/devices/{$deviceId}/messages", [
                    'limit' => $limit,
                    'since' => now()->subDays(7)->timestamp * 1000, // 7日前から
                ]);

            if ($response->successful()) {
                $data = $response->json();
                Log::info("Sigfox API: Retrieved " . count($data['data']) . " messages for device {$deviceId}");
                return $data['data'] ?? [];
            }

            Log::error("Sigfox API Error for device {$deviceId}: " . $response->status());
            return null;

        } catch (\Exception $e) {
            Log::error("Sigfox API Exception for device {$deviceId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * 全デバイスのデータを取得して保存
     */
    public function syncAllDevices(): int
    {
        $devices = Device::where('is_active', true)->get();
        $totalSynced = 0;

        foreach ($devices as $device) {
            $synced = $this->syncDevice($device);
            $totalSynced += $synced;
            Log::info("Device {$device->sigfox_device_id}: Synced {$synced} new records");
        }

        Log::info("Sync completed: {$totalSynced} total new records across " . $devices->count() . " devices");
        return $totalSynced;
    }

    /**
     * 単一デバイスのデータを同期
     */
    public function syncDevice(Device $device): int
    {
        $messages = $this->getDeviceMessages($device->sigfox_device_id);
        
        if (!$messages) {
            return 0;
        }

        $syncedCount = 0;
        $lastSeenTime = null;

        foreach ($messages as $message) {
            // 重複チェック
            $exists = TemperatureData::where('device_id', $device->id)
                ->where('sigfox_time', $message['time'])
                ->exists();

            if ($exists) {
                continue;
            }

            // 温度データを抽出（デバイス固有の解析ロジック）
            $temperature = $this->parseTemperatureData($message['data']);
            
            if ($temperature === null) {
                Log::warning("Could not parse temperature data for device {$device->sigfox_device_id}: {$message['data']}");
                continue;
            }

            // バッテリーデータも抽出
            $batteryData = $this->parseBatteryData($message['data']);
            
            // デバイスのバッテリー情報を更新
            if ($batteryData['battery_level'] !== null) {
                $device->update([
                    'battery_level' => $batteryData['battery_level'],
                    'battery_voltage' => $batteryData['battery_voltage'],
                ]);
            }

            // データ保存
            $temperatureData = TemperatureData::create([
                'device_id' => $device->id,
                'sigfox_time' => $message['time'],
                'temperature' => $temperature,
                'rssi' => $message['rssi'] ?? null,
                'snr' => $message['snr'] ?? null,
                'raw_data' => $message['data'],
                'battery_level' => $batteryData['battery_level'],
                'battery_voltage' => $batteryData['battery_voltage'],
                'station_rssi' => $message['station_rssi'] ?? null,
            ]);

            // 温度異常通知チェック
            $this->checkTemperatureAlert($device, $temperatureData);
            
            // バッテリー低下通知チェック
            $this->checkBatteryAlert($device, $temperatureData);

            $syncedCount++;
            
            // 最新の受信時刻を記録
            if (!$lastSeenTime || $message['time'] > $lastSeenTime) {
                $lastSeenTime = $message['time'];
            }
        }

        // デバイスの最終接続時刻を更新
        if ($lastSeenTime) {
            $device->update([
                'last_seen' => Carbon::createFromTimestamp($lastSeenTime)
            ]);
        }

        return $syncedCount;
    }

    /**
     * バッテリー低下通知チェック
     */
    private function checkBatteryAlert(Device $device, TemperatureData $temperatureData): void
    {
        $batteryLevel = $temperatureData->battery_level;
        $batteryVoltage = $temperatureData->battery_voltage;
        $user = $device->user;
        
        // バッテリーデータがない場合はスキップ
        if ($batteryLevel === null || $batteryVoltage === null) {
            return;
        }
        
        // 通知先メールアドレスがない場合は通知しない
        $emails = $user->userEmails()->pluck('email')->toArray();
        if (empty($emails)) {
            return;
        }

        $alertType = null;
        $shouldNotify = false;
        $message = '';

        // バッテリー切れ警告（10%以下または2.0V以下）
        if ($batteryLevel <= 10 || $batteryVoltage <= 2.0) {
            $alertType = 'battery_critical';
            $shouldNotify = true;
            $message = '早急に充電が必要です。放電終止電圧に近づいており、電池が劣化する恐れがあります。';
        }
        // バッテリー低下通知（20%以下または2.05V以下）
        elseif ($batteryLevel <= 20 || $batteryVoltage <= 2.05) {
            $alertType = 'battery_low';
            $shouldNotify = true;
            $message = '充電を推奨します。';
        }

        if ($shouldNotify) {
            // 重複通知を防ぐため、過去6時間以内に同じタイプの通知を送信していないかチェック
            $recentAlert = $user->temperatureAlerts()
                ->where('device_id', $device->id)
                ->where('alert_type', $alertType)
                ->where('created_at', '>', Carbon::now()->subHours(6))
                ->exists();

            if (!$recentAlert) {
                $this->sendBatteryAlert($device, $temperatureData, $alertType, $message, $emails);
                
                // アラート履歴を記録
                $user->temperatureAlerts()->create([
                    'device_id' => $device->id,
                    'temperature' => $temperatureData->temperature,
                    'alert_type' => $alertType,
                    'battery_level' => $batteryLevel,
                    'battery_voltage' => $batteryVoltage,
                    'notified_at' => Carbon::now(),
                    'emails_sent' => implode(',', $emails),
                ]);

                Log::info('Battery alert sent', [
                    'device_id' => $device->id,
                    'battery_level' => $batteryLevel,
                    'battery_voltage' => $batteryVoltage,
                    'alert_type' => $alertType,
                    'emails' => $emails
                ]);
            }
        }
    }

    /**
     * 温度異常通知チェック
     */
    private function checkTemperatureAlert(Device $device, TemperatureData $temperatureData): void
    {
        $temperature = $temperatureData->temperature;
        $user = $device->user;
        
        // 通知先メールアドレスがない場合は通知しない
        $emails = $user->userEmails()->pluck('email')->toArray();
        if (empty($emails)) {
            return;
        }

        $alertType = null;
        $shouldNotify = false;

        // 高温警告チェック（より重要なので先にチェック）
        if ($device->temp_alert_threshold && $temperature >= $device->temp_alert_threshold) {
            $alertType = 'critical';
            $shouldNotify = true;
        }
        // 低温通知チェック
        elseif ($device->temp_notification_threshold && $temperature <= $device->temp_notification_threshold) {
            $alertType = 'warning';
            $shouldNotify = true;
        }

        if ($shouldNotify) {
            // 重複通知を防ぐため、過去1時間以内に同じタイプの通知を送信していないかチェック
            $recentAlert = $user->temperatureAlerts()
                ->where('device_id', $device->id)
                ->where('alert_type', $alertType)
                ->where('created_at', '>', Carbon::now()->subHour())
                ->exists();

            if (!$recentAlert) {
                $this->sendTemperatureAlert($device, $temperatureData, $alertType, $emails);
                
                // アラート履歴を記録
                $user->temperatureAlerts()->create([
                    'device_id' => $device->id,
                    'temperature' => $temperature,
                    'alert_type' => $alertType,
                    'notified_at' => Carbon::now(),
                    'emails_sent' => implode(',', $emails),
                ]);

                Log::info('Temperature alert sent', [
                    'device_id' => $device->id,
                    'temperature' => $temperature,
                    'alert_type' => $alertType,
                    'emails' => $emails
                ]);
            }
        }
    }

    /**
     * 温度異常通知メール送信
     */
    private function sendTemperatureAlert(Device $device, TemperatureData $temperatureData, string $alertType, array $emails): void
    {
        try {
            $detectedAt = Carbon::createFromTimestamp($temperatureData->sigfox_time);
            
            foreach ($emails as $email) {
                Mail::send('emails.temperature_alert', [
                    'user' => $device->user,
                    'device' => $device,
                    'temperature' => $temperatureData->temperature,
                    'detectedAt' => $detectedAt,
                    'alertType' => $alertType,
                ], function ($message) use ($email, $device, $temperatureData, $alertType) {
                    $alertTitle = $alertType === 'critical' ? '高温警告' : '低温通知';
                    $message->to($email)
                        ->subject("FoxSense One {$alertTitle}: {$device->device_name}で温度異常が検知されました");
                });
            }
        } catch (\Exception $e) {
            Log::error('Failed to send temperature alert', [
                'device_id' => $device->id,
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * Sigfoxペイロードから温度データを解析
     * FoxSense Oneの場合: 最初の4バイトが温度（16bit、100倍値）
     */
    private function parseTemperatureData(string $hexData): ?float
    {
        // 16進データから温度を抽出
        // 例: "0BEF0C53270C" → 最初の4文字 "0BEF" = 3055 → 30.55°C
        
        if (strlen($hexData) < 4) {
            return null;
        }

        $tempHex = substr($hexData, 0, 4);
        $tempInt = hexdec($tempHex);
        
        // 16bit符号付き整数として処理
        if ($tempInt > 32767) {
            $tempInt = $tempInt - 65536;
        }
        
        return $tempInt / 100.0;
    }

    /**
     * Sigfoxペイロードからバッテリーデータを解析
     * ペイロード形式: 温度(2バイト) + バッテリーレベル(1バイト) + バッテリー電圧(2バイト) + 予備(3バイト)
     */
    private function parseBatteryData(string $hexData): array
    {
        $result = [
            'battery_level' => null,
            'battery_voltage' => null,
        ];
        
        if (strlen($hexData) < 10) { // 最低5バイト（10文字）必要
            return $result;
        }
        
        try {
            // バッテリーレベル（5文字目から2文字 = 1バイト）
            $batteryLevelHex = substr($hexData, 4, 2);
            $batteryLevel = hexdec($batteryLevelHex);
            if ($batteryLevel <= 100) { // 妥当性チェック
                $result['battery_level'] = $batteryLevel;
            }
            
            // バッテリー電圧（7文字目から4文字 = 2バイト）
            $batteryVoltageHex = substr($hexData, 6, 4);
            $batteryVoltageInt = hexdec($batteryVoltageHex);
            $batteryVoltage = $batteryVoltageInt / 100.0;
            if ($batteryVoltage > 0 && $batteryVoltage < 10) { // 妥当性チェック
                $result['battery_voltage'] = $batteryVoltage;
            }
            
        } catch (\Exception $e) {
            Log::warning("Could not parse battery data: {$hexData}", ['error' => $e->getMessage()]);
        }
        
        return $result;
    }

    /**
     * バッテリー低下通知メール送信
     */
    private function sendBatteryAlert(Device $device, TemperatureData $temperatureData, string $alertType, string $message, array $emails): void
    {
        try {
            $detectedAt = Carbon::createFromTimestamp($temperatureData->sigfox_time);
            
            foreach ($emails as $email) {
                \Mail::send('emails.battery_alert', [
                    'user' => $device->user,
                    'device' => $device,
                    'batteryLevel' => $temperatureData->battery_level,
                    'batteryVoltage' => $temperatureData->battery_voltage,
                    'temperature' => $temperatureData->temperature,
                    'detectedAt' => $detectedAt,
                    'alertType' => $alertType,
                    'message' => $message,
                ], function ($message) use ($email, $device, $temperatureData, $alertType) {
                    $alertTitle = $alertType === 'battery_critical' ? '緊急：バッテリー切れ警告' : 'バッテリー低下通知';
                    $message->to($email)
                        ->subject("FoxSense One {$alertTitle}: {$device->device_name}");
                });
            }
        } catch (\Exception $e) {
            Log::error('Failed to send battery alert', [
                'device_id' => $device->id,
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * デバイス情報を取得
     */
    public function getDeviceInfo(string $deviceId): ?array
    {
        try {
            $response = Http::withBasicAuth($this->username, $this->password)
                ->timeout(30)
                ->get("{$this->baseUrl}/devices/{$deviceId}");

            if ($response->successful()) {
                return $response->json();
            }

            Log::error("Sigfox API Error getting device info for {$deviceId}: " . $response->status());
            return null;

        } catch (\Exception $e) {
            Log::error("Sigfox API Exception getting device info for {$deviceId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * API認証テスト
     */
    public function testConnection(): bool
    {
        try {
            $response = Http::withBasicAuth($this->username, $this->password)
                ->timeout(10)
                ->get("{$this->baseUrl}/device-types");

            return $response->successful();

        } catch (\Exception $e) {
            Log::error("Sigfox API connection test failed: " . $e->getMessage());
            return false;
        }
    }
}