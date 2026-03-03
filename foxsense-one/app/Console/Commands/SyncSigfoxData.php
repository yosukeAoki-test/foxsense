<?php

namespace App\Console\Commands;

use App\Services\SigfoxApiService;
use Illuminate\Console\Command;

class SyncSigfoxData extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'foxsense:sync {--device= : Specific device ID to sync} {--force : Force sync even if recently synced} {--days=7 : Number of days to sync back}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Sync temperature data from Sigfox API to local database automatically';

    private SigfoxApiService $sigfoxService;

    public function __construct(SigfoxApiService $sigfoxService)
    {
        parent::__construct();
        $this->sigfoxService = $sigfoxService;
    }

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $startTime = now();
        $this->info('🌡️  FoxSense One - Sigfox Data Sync Started at ' . $startTime->format('Y-m-d H:i:s'));
        
        // API接続テスト
        if (!$this->sigfoxService->testConnection()) {
            $this->error('❌ Sigfox API connection failed. Check SIGFOX_USERNAME and SIGFOX_PASSWORD in .env');
            return 1;
        }
        
        $this->info('✅ Sigfox API connection successful');

        $deviceId = $this->option('device');
        $force = $this->option('force');
        $days = (int) $this->option('days');
        
        if ($deviceId) {
            // 特定デバイスの同期
            $device = \App\Models\Device::where('sigfox_device_id', $deviceId)->first();
            
            if (!$device) {
                $this->error("❌ Device with ID {$deviceId} not found");
                return 1;
            }
            
            $this->info("🔄 Syncing device: {$device->device_name} ({$deviceId})");
            $synced = $this->sigfoxService->syncDevice($device);
            $this->info("✅ Synced {$synced} new temperature records for device {$deviceId}");
            
        } else {
            // 全デバイスの同期
            $activeDevices = \App\Models\Device::where('is_active', true)->count();
            $this->info("🔄 Syncing {$activeDevices} active devices...");
            
            $totalSynced = $this->sigfoxService->syncAllDevices();
            $this->info("✅ Total synced: {$totalSynced} new temperature records across {$activeDevices} devices");
        }

        $endTime = now();
        $duration = $endTime->diffInSeconds($startTime);
        $this->info("🎉 Sync completed successfully in {$duration} seconds");
        
        // 統計情報を表示
        $this->displaySyncStats();
        
        return 0;
    }
    
    /**
     * 同期統計情報を表示
     */
    private function displaySyncStats(): void
    {
        $this->info('📊 Current Statistics:');
        
        $totalDevices = \App\Models\Device::count();
        $activeDevices = \App\Models\Device::where('is_active', true)->count();
        $totalRecords = \App\Models\TemperatureData::count();
        $todayRecords = \App\Models\TemperatureData::whereDate('created_at', today())->count();
        
        $this->line("   📱 Total devices: {$totalDevices}");
        $this->line("   🟢 Active devices: {$activeDevices}");
        $this->line("   📊 Total temperature records: " . number_format($totalRecords));
        $this->line("   📈 Today's records: {$todayRecords}");
        
        // 最新データの情報
        $latestRecord = \App\Models\TemperatureData::latest('sigfox_time')->first();
        if ($latestRecord) {
            $latestTime = \Carbon\Carbon::createFromTimestamp($latestRecord->sigfox_time);
            $this->line("   🕐 Latest data: {$latestTime->diffForHumans()} ({$latestRecord->temperature}°C)");
        }
    }
}
