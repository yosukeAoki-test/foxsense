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
        Schema::create('devices', function (Blueprint $table) {
            $table->id();
            $table->string('sigfox_device_id', 8)->unique()->comment('SigfoxデバイスID');
            $table->string('device_name')->comment('デバイス名');
            $table->string('location')->nullable()->comment('設置場所');
            $table->decimal('temp_min', 5, 2)->default(-10.00)->comment('温度下限閾値');
            $table->decimal('temp_max', 5, 2)->default(40.00)->comment('温度上限閾値');
            $table->foreignId('user_id')->constrained()->onDelete('cascade')->comment('所有者');
            $table->boolean('is_active')->default(true)->comment('アクティブフラグ');
            $table->timestamp('last_seen')->nullable()->comment('最終データ受信時刻');
            $table->timestamps();
            
            $table->index(['user_id', 'is_active']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('devices');
    }
};
