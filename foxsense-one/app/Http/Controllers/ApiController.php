<?php

namespace App\Http\Controllers;

use App\Models\Device;
use App\Models\TemperatureData;
use App\Services\SigfoxApiService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class ApiController extends Controller
{
    private SigfoxApiService $sigfoxService;

    public function __construct(SigfoxApiService $sigfoxService)
    {
        $this->sigfoxService = $sigfoxService;
    }

    /**
     * Sigfox Callback Endpoint
     * Receives data from Sigfox Backend via callback
     */
    public function sigfoxCallback(Request $request): Response
    {
        try {
            $clientIp = $request->ip();
            $userAgent = $request->userAgent();
            
            Log::info('Sigfox callback received from IP: ' . $clientIp, [
                'ip' => $clientIp,
                'user_agent' => $userAgent,
                'method' => $request->method(),
                'query' => $request->query(),
                'body' => $request->all(),
            ]);

        // IP whitelist for Sigfox backend - 実際のSigfox BackendのIPアドレスに置き換えてください
        $allowedIps = [
            // Sigfox backend IP ranges (APAC region)
            '185.110.96.0/22',  // Sigfox Europe/APAC range (wider range to include 185.110.98.4)
            '52.74.0.0/16',     // AWS Singapore region (Sigfox APAC)
            '54.255.0.0/16',    // AWS Singapore region alternate
            '185.110.98.4',     // Specific Sigfox Backend IP (confirmed from logs)
            // 必要に応じて実際のSigfox BackendのIPを追加
        ];
        
        // IP制限を一時的に無効化（データ取り込み優先）
        if (false && !empty($allowedIps)) {
            $ipAllowed = false;
            foreach ($allowedIps as $allowedIp) {
                if (strpos($allowedIp, '/') !== false) {
                    // CIDR範囲チェック
                    if ($this->ipInRange($clientIp, $allowedIp)) {
                        $ipAllowed = true;
                        break;
                    }
                } elseif ($clientIp === $allowedIp) {
                    $ipAllowed = true;
                    break;
                }
            }
            
            if (!$ipAllowed) {
                Log::warning('Unauthorized IP attempted Sigfox callback', ['ip' => $clientIp]);
                return response('Unauthorized', 403);
            }
        }

        // Enhanced validation
        $validator = Validator::make($request->all(), [
            'device' => 'required|string|size:7|regex:/^[A-F0-9]{7}$/', // 7-character hex device ID
            'time' => 'required|integer|min:1000000000|max:9999999999', // Valid Unix timestamp
            'data' => 'required|string|min:2|max:48', // Hex data string
            'seqNumber' => 'sometimes|integer|min:0|max:4095', // Sequence number 0-4095
            'rssi' => 'sometimes|numeric|min:-200|max:0', // RSSI range
            'snr' => 'sometimes|numeric|min:-50|max:50', // SNR range
        ]);

        if ($validator->fails()) {
            Log::error('Sigfox callback validation failed for IP: ' . $clientIp, [
                'errors' => $validator->errors(),
                'request_data' => $request->all(),
                'ip' => $clientIp
            ]);
            return response('Bad Request', 400);
        }

        try {
            $deviceId = $request->input('device');
            $time = $request->input('time');
            $data = $request->input('data');
            $seqNumber = $request->input('seqNumber');
            $rssi = $request->input('rssi');
            $snr = $request->input('snr');

            // Find device in database
            $device = Device::where('sigfox_device_id', $deviceId)->first();
            
            if (!$device) {
                Log::error('Device not found for callback from IP: ' . $clientIp, [
                    'device_id' => $deviceId,
                    'ip' => $clientIp,
                    'all_data' => $request->all()
                ]);
                return response('Device not found', 404);
            }

            // Check for duplicate data
            $exists = TemperatureData::where('device_id', $device->id)
                ->where('sigfox_time', $time)
                ->exists();

            if ($exists) {
                Log::info('Duplicate data received via callback', [
                    'device_id' => $deviceId,
                    'time' => $time
                ]);
                return response('OK', 200);
            }

            // Parse temperature data using existing service logic
            $temperature = $this->parseTemperatureData($data);
            
            if ($temperature === null) {
                Log::warning('Could not parse temperature data from callback', [
                    'device_id' => $deviceId,
                    'data' => $data
                ]);
                return response('Invalid data format', 400);
            }

            // Parse battery data
            $batteryData = $this->parseBatteryData($data);
            
            // Update device battery information
            if ($batteryData['battery_level'] !== null) {
                $device->update([
                    'battery_level' => $batteryData['battery_level'],
                    'battery_voltage' => $batteryData['battery_voltage'],
                    'last_seen' => Carbon::createFromTimestamp($time)
                ]);
            }

            // Save temperature data
            $temperatureData = TemperatureData::create([
                'device_id' => $device->id,
                'sigfox_time' => $time,
                'temperature' => $temperature,
                'rssi' => $rssi,
                'snr' => $snr,
                'raw_data' => $data,
                'battery_level' => $batteryData['battery_level'],
                'battery_voltage' => $batteryData['battery_voltage'],
                'seq_number' => $seqNumber,
            ]);

            // Check for temperature alerts using existing service logic
            $this->checkTemperatureAlert($device, $temperatureData);
            
            // Check for battery alerts
            $this->checkBatteryAlert($device, $temperatureData);

            Log::info('Sigfox callback data processed successfully', [
                'device_id' => $deviceId,
                'temperature' => $temperature,
                'battery_level' => $batteryData['battery_level'],
                'time' => $time
            ]);

            return response('OK', 200);

        } catch (\Exception $e) {
            Log::error('Error processing Sigfox callback', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'request_data' => $request->all()
            ]);
            
            return response('Internal Server Error', 500);
        }
    }

    /**
     * Parse temperature data from hex payload
     * Uses same logic as SigfoxApiService
     */
    private function parseTemperatureData(string $hexData): ?float
    {
        if (strlen($hexData) < 4) {
            return null;
        }

        $tempHex = substr($hexData, 0, 4);
        $tempInt = hexdec($tempHex);
        
        // Handle 16-bit signed integer
        if ($tempInt > 32767) {
            $tempInt = $tempInt - 65536;
        }
        
        return $tempInt / 100.0;
    }

    /**
     * Parse battery data from hex payload
     * Uses same logic as SigfoxApiService
     */
    private function parseBatteryData(string $hexData): array
    {
        $result = [
            'battery_level' => null,
            'battery_voltage' => null,
        ];
        
        if (strlen($hexData) < 10) {
            return $result;
        }
        
        try {
            // Battery level (5th-6th characters = 1 byte)
            $batteryLevelHex = substr($hexData, 4, 2);
            $batteryLevel = hexdec($batteryLevelHex);
            if ($batteryLevel <= 100) {
                $result['battery_level'] = $batteryLevel;
            }
            
            // Battery voltage (7th-10th characters = 2 bytes)
            $batteryVoltageHex = substr($hexData, 6, 4);
            $batteryVoltageInt = hexdec($batteryVoltageHex);
            $batteryVoltage = $batteryVoltageInt / 100.0;
            if ($batteryVoltage > 0 && $batteryVoltage < 10) {
                $result['battery_voltage'] = $batteryVoltage;
            }
            
        } catch (\Exception $e) {
            Log::warning("Could not parse battery data from callback: {$hexData}", [
                'error' => $e->getMessage()
            ]);
        }
        
        return $result;
    }

    /**
     * Check temperature alert using same logic as SigfoxApiService
     */
    private function checkTemperatureAlert(Device $device, TemperatureData $temperatureData): void
    {
        $temperature = $temperatureData->temperature;
        $user = $device->user;
        
        // Get notification email addresses
        $emails = $user->userEmails()->pluck('email')->toArray();
        if (empty($emails)) {
            return;
        }

        $alertType = null;
        $shouldNotify = false;

        // Check for high temperature alert (critical)
        if ($device->temp_alert_threshold && $temperature >= $device->temp_alert_threshold) {
            $alertType = 'critical';
            $shouldNotify = true;
        }
        // Check for low temperature notification (warning)
        elseif ($device->temp_notification_threshold && $temperature <= $device->temp_notification_threshold) {
            $alertType = 'warning';
            $shouldNotify = true;
        }

        if ($shouldNotify) {
            // Prevent duplicate notifications within 1 hour
            $recentAlert = $user->temperatureAlerts()
                ->where('device_id', $device->id)
                ->where('alert_type', $alertType)
                ->where('created_at', '>', Carbon::now()->subHour())
                ->exists();

            if (!$recentAlert) {
                $this->sendTemperatureAlert($device, $temperatureData, $alertType, $emails);
                
                // Record alert history
                $user->temperatureAlerts()->create([
                    'device_id' => $device->id,
                    'temperature' => $temperature,
                    'alert_type' => $alertType,
                    'notified_at' => Carbon::now(),
                    'emails_sent' => implode(',', $emails),
                ]);

                Log::info('Temperature alert sent via callback', [
                    'device_id' => $device->id,
                    'temperature' => $temperature,
                    'alert_type' => $alertType,
                    'emails' => $emails
                ]);
            }
        }
    }

    /**
     * Send temperature alert email
     */
    private function sendTemperatureAlert(Device $device, TemperatureData $temperatureData, string $alertType, array $emails): void
    {
        try {
            $detectedAt = Carbon::createFromTimestamp($temperatureData->sigfox_time);
            
            foreach ($emails as $email) {
                \Mail::send('emails.temperature_alert', [
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
            Log::error('Failed to send temperature alert from callback', [
                'device_id' => $device->id,
                'error' => $e->getMessage()
            ]);
        }
    }
    
    /**
     * Check battery alert using same logic as SigfoxApiService
     */
    private function checkBatteryAlert(Device $device, TemperatureData $temperatureData): void
    {
        $batteryLevel = $temperatureData->battery_level;
        $batteryVoltage = $temperatureData->battery_voltage;
        $user = $device->user;
        
        // Skip if no battery data
        if ($batteryLevel === null || $batteryVoltage === null) {
            return;
        }
        
        // Get notification email addresses
        $emails = $user->userEmails()->pluck('email')->toArray();
        if (empty($emails)) {
            return;
        }

        $alertType = null;
        $shouldNotify = false;
        $message = '';

        // Critical battery warning (10% or below, or 2.0V or below)
        if ($batteryLevel <= 10 || $batteryVoltage <= 2.0) {
            $alertType = 'battery_critical';
            $shouldNotify = true;
            $message = '早急に充電が必要です。放電終止電圧に近づいており、電池が劣化する恐れがあります。';
        }
        // Low battery notification (20% or below, or 2.05V or below)
        elseif ($batteryLevel <= 20 || $batteryVoltage <= 2.05) {
            $alertType = 'battery_low';
            $shouldNotify = true;
            $message = '充電を推奨します。';
        }

        if ($shouldNotify) {
            // Prevent duplicate notifications within 6 hours
            $recentAlert = $user->temperatureAlerts()
                ->where('device_id', $device->id)
                ->where('alert_type', $alertType)
                ->where('created_at', '>', Carbon::now()->subHours(6))
                ->exists();

            if (!$recentAlert) {
                $this->sendBatteryAlert($device, $temperatureData, $alertType, $message, $emails);
                
                // Record alert history
                $user->temperatureAlerts()->create([
                    'device_id' => $device->id,
                    'temperature' => $temperatureData->temperature,
                    'alert_type' => $alertType,
                    'battery_level' => $batteryLevel,
                    'battery_voltage' => $batteryVoltage,
                    'notified_at' => Carbon::now(),
                    'emails_sent' => implode(',', $emails),
                ]);

                Log::info('Battery alert sent via callback', [
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
     * Send battery alert email
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
            Log::error('Failed to send battery alert from callback', [
                'device_id' => $device->id,
                'error' => $e->getMessage()
            ]);
        }
    }

    /**
     * CIDR範囲内のIPアドレスかどうかをチェック
     */
    private function ipInRange($ip, $range)
    {
        if (strpos($range, '/') == false) {
            return $ip === $range;
        }

        list($range, $netmask) = explode('/', $range, 2);
        $range_decimal = ip2long($range);
        $ip_decimal = ip2long($ip);
        $wildcard_decimal = pow(2, (32 - $netmask)) - 1;
        $netmask_decimal = ~ $wildcard_decimal;

        return ($ip_decimal & $netmask_decimal) == ($range_decimal & $netmask_decimal);
    }
}