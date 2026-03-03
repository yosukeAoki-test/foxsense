<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserEmail extends Model
{
    protected $fillable = [
        'user_id',
        'email',
        'is_verified'
    ];

    protected $casts = [
        'is_verified' => 'boolean'
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
