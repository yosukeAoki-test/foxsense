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
        Schema::table('users', function (Blueprint $table) {
            $table->string('username')->unique()->nullable()->after('name');
            $table->boolean('is_admin')->default(false)->after('email');
            $table->decimal('temp_notification_threshold', 5, 2)->default(25.00)->after('is_admin')->comment('通知温度閾値');
            $table->decimal('temp_alert_threshold', 5, 2)->default(35.00)->after('temp_notification_threshold')->comment('アラート温度閾値');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['username', 'is_admin', 'temp_notification_threshold', 'temp_alert_threshold']);
        });
    }
};
