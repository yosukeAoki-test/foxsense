<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Device extends Model
{
    protected $fillable = [
        'sigfox_device_id',
        'device_name',
        'location',
        'temp_min',
        'temp_max',
        'temp_notification_threshold',
        'temp_alert_threshold',
        'user_id',
        'is_active',
        'last_seen',
        'battery_level',
        'battery_voltage'
    ];

    protected $casts = [
        'temp_min' => 'decimal:2',
        'temp_max' => 'decimal:2',
        'temp_notification_threshold' => 'decimal:2',
        'temp_alert_threshold' => 'decimal:2',
        'is_active' => 'boolean',
        'last_seen' => 'datetime',
        'battery_level' => 'integer',
        'battery_voltage' => 'decimal:2'
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function temperatureData(): HasMany
    {
        return $this->hasMany(TemperatureData::class);
    }

    public function latestTemperatureData(): HasMany
    {
        return $this->hasMany(TemperatureData::class)->latest();
    }

    public function getLatestTemperatureAttribute()
    {
        return $this->temperatureData()->latest()->first()?->temperature;
    }

    public function isOnline(): bool
    {
        return $this->last_seen && $this->last_seen->diffInMinutes(now()) <= 30;
    }

    public function getBatteryStatusAttribute(): string
    {
        if (!$this->battery_level) return 'unknown';
        if ($this->battery_level >= 75) return 'good';
        if ($this->battery_level >= 50) return 'normal';
        if ($this->battery_level >= 25) return 'low';
        return 'critical';
    }

    public function getBatteryIconAttribute(): string
    {
        if (!$this->battery_level) return '🔋';
        if ($this->battery_level >= 75) return '🔋';
        if ($this->battery_level >= 50) return '🔋';
        if ($this->battery_level >= 25) return '🪫';
        return '🪫';
    }
}
