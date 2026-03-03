<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TemperatureData extends Model
{
    protected $fillable = [
        'device_id',
        'sigfox_time',
        'temperature',
        'battery_level',
        'battery_voltage',
        'rssi',
        'station_rssi',
        'snr',
        'raw_data'
    ];

    protected $casts = [
        'temperature' => 'decimal:2',
        'battery_level' => 'integer',
        'battery_voltage' => 'decimal:2',
        'rssi' => 'integer',
        'station_rssi' => 'integer',
        'snr' => 'decimal:1',
        'sigfox_time' => 'integer'
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function getSigfoxTimestampAttribute()
    {
        return \Carbon\Carbon::createFromTimestamp($this->sigfox_time)->setTimezone('Asia/Tokyo');
    }

    public function getSigfoxTimeAttribute($value)
    {
        // タイムスタンプをCarbonインスタンスに変換（JSTで）
        return $value ? \Carbon\Carbon::createFromTimestamp($value)->setTimezone('Asia/Tokyo') : null;
    }

    public function isHighTemperature(): bool
    {
        return $this->temperature > $this->device->temp_max;
    }

    public function isLowTemperature(): bool
    {
        return $this->temperature < $this->device->temp_min;
    }

    public function hasAlert(): bool
    {
        return $this->isHighTemperature() || $this->isLowTemperature();
    }

    public function getSignalQualityAttribute(): string
    {
        if (!$this->rssi) return 'unknown';
        if ($this->rssi >= -85) return 'excellent';
        if ($this->rssi >= -95) return 'good';
        if ($this->rssi >= -105) return 'fair';
        return 'poor';
    }

    public function getSignalColorAttribute(): string
    {
        $quality = $this->signal_quality;
        return match($quality) {
            'excellent' => '#059669',
            'good' => '#3b82f6',
            'fair' => '#f59e0b',
            'poor' => '#dc2626',
            default => '#6b7280'
        };
    }
}
