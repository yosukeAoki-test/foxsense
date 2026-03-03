<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'username', 
        'email',
        'password',
        // 'is_admin' を削除 - セキュリティ上の理由で mass assignment から除外
        'temp_notification_threshold',
        'temp_alert_threshold'
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'temp_notification_threshold' => 'decimal:2',
            'temp_alert_threshold' => 'decimal:2'
        ];
    }

    /**
     * デバイスリレーション
     */
    public function devices()
    {
        return $this->hasMany(Device::class);
    }

    /**
     * 通知先メールアドレス
     */
    public function userEmails()
    {
        return $this->hasMany(UserEmail::class);
    }

    /**
     * 温度アラート履歴
     */
    public function temperatureAlerts()
    {
        return $this->hasMany(TemperatureAlert::class);
    }

    /**
     * 管理者かどうか判定
     */
    public function isAdmin(): bool
    {
        return $this->is_admin;
    }
}
