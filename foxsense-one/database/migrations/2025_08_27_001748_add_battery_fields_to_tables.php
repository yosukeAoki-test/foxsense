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
        // デバイステーブルに最新バッテリー残量を追加
        Schema::table('devices', function (Blueprint $table) {
            $table->integer('battery_level')->nullable()->after('last_seen')
                ->comment('Battery level percentage (0-100)');
            $table->decimal('battery_voltage', 4, 2)->nullable()->after('battery_level')
                ->comment('Battery voltage (V)');
        });

        // 温度データテーブルにバッテリー情報を追加
        Schema::table('temperature_data', function (Blueprint $table) {
            $table->integer('battery_level')->nullable()->after('temperature')
                ->comment('Battery level percentage (0-100)');
            $table->decimal('battery_voltage', 4, 2)->nullable()->after('battery_level')
                ->comment('Battery voltage (V)');
            $table->integer('station_rssi')->nullable()->after('rssi')
                ->comment('Station RSSI (dBm)');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropColumn(['battery_level', 'battery_voltage']);
        });

        Schema::table('temperature_data', function (Blueprint $table) {
            $table->dropColumn(['battery_level', 'battery_voltage', 'station_rssi']);
        });
    }
};
