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
        Schema::create('temperature_alerts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->foreignId('device_id')->constrained()->onDelete('cascade');
            $table->decimal('temperature', 5, 2)->comment('検知時の温度');
            $table->string('alert_type')->comment('アラートタイプ: critical, warning');
            $table->timestamp('notified_at')->comment('通知送信日時');
            $table->text('emails_sent')->nullable()->comment('送信先メールアドレス（カンマ区切り）');
            $table->timestamps();

            // インデックス
            $table->index(['user_id', 'device_id', 'alert_type', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('temperature_alerts');
    }
};
