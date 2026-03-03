<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TemperatureAlert extends Model
{
    protected $fillable = [
        'user_id',
        'device_id',
        'temperature',
        'alert_type',
        'notified_at',
        'emails_sent',
    ];

    protected $casts = [
        'temperature' => 'decimal:2',
        'notified_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
