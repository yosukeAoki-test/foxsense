<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Sigfoxデータ自動同期スケジュール
Schedule::command('foxsense:sync')
    ->everyFiveMinutes()
    ->withoutOverlapping(10) // 10分でタイムアウト
    ->runInBackground()
    ->emailOutputOnFailure(['support@example.com']) // エラー時の通知先
    ->appendOutputTo(storage_path('logs/sigfox-sync.log'));

// より頻繁な同期が必要な場合のオプション（コメントアウト）
// Schedule::command('foxsense:sync')
//     ->everyTwoMinutes()
//     ->withoutOverlapping(5)
//     ->runInBackground();

// 夜間の詳細同期（過去24時間のデータを再取得）
Schedule::command('foxsense:sync')
    ->daily()
    ->at('02:00')
    ->withoutOverlapping(60) // 1時間でタイムアウト
    ->runInBackground()
    ->emailOutputTo(['admin@example.com'])
    ->appendOutputTo(storage_path('logs/sigfox-sync-daily.log'));
