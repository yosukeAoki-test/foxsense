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
        Schema::create('temperature_data', function (Blueprint $table) {
            $table->id();
            $table->foreignId('device_id')->constrained()->onDelete('cascade');
            $table->integer('sigfox_time')->comment('Sigfox送信時刻（UNIX timestamp）');
            $table->decimal('temperature', 5, 2)->comment('温度（°C）');
            $table->integer('rssi')->nullable()->comment('RSSI値');
            $table->decimal('snr', 4, 1)->nullable()->comment('SNR値');
            $table->string('raw_data', 24)->nullable()->comment('生データ（16進）');
            $table->timestamps();
            
            $table->unique(['device_id', 'sigfox_time'], 'unique_device_time');
            $table->index(['device_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('temperature_data');
    }
};
