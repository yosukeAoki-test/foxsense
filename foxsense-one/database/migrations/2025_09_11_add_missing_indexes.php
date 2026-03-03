<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('temperature_data', function (Blueprint $table) {
            // Sigfox時刻でのインデックス（グラフ生成で頻繁に使用）
            $table->index('sigfox_time');
            
            // デバイスIDとSigfox時刻の複合インデックス
            $table->index(['device_id', 'sigfox_time'], 'idx_device_sigfox_time');
            
            // 温度値のインデックス（アラート処理で使用）
            $table->index('temperature');
            
            // 作成日時のインデックス（統計処理で使用）
            $table->index('created_at');
        });

        Schema::table('devices', function (Blueprint $table) {
            // 最終確認時刻のインデックス（オンライン状態判定で使用）
            $table->index('last_seen');
            
            // ユーザーIDとアクティブ状態の複合インデックス
            $table->index(['user_id', 'is_active'], 'idx_user_active');
            
            // バッテリーレベルのインデックス（バッテリー警告で使用）
            $table->index('battery_level');
        });

        Schema::table('users', function (Blueprint $table) {
            // 管理者フラグのインデックス（権限チェックで使用）
            $table->index('is_admin');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('temperature_data', function (Blueprint $table) {
            $table->dropIndex(['sigfox_time']);
            $table->dropIndex('idx_device_sigfox_time');
            $table->dropIndex(['temperature']);
            $table->dropIndex(['created_at']);
        });

        Schema::table('devices', function (Blueprint $table) {
            $table->dropIndex(['last_seen']);
            $table->dropIndex('idx_user_active');
            $table->dropIndex(['battery_level']);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['is_admin']);
        });
    }
};