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
        Schema::table('devices', function (Blueprint $table) {
            $table->decimal('temp_notification_threshold', 5, 2)->nullable()->after('temp_max')
                ->comment('Temperature notification threshold (low limit)');
            $table->decimal('temp_alert_threshold', 5, 2)->nullable()->after('temp_notification_threshold')  
                ->comment('Temperature alert threshold (high limit)');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('devices', function (Blueprint $table) {
            $table->dropColumn(['temp_notification_threshold', 'temp_alert_threshold']);
        });
    }
};
