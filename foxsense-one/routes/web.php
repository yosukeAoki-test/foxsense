<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\WebController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
})->name('home');

// Authentication Routes
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
    Route::post('/login', [AuthController::class, 'login']);
    Route::get('/register', [AuthController::class, 'showRegister'])->name('register');
    Route::post('/register', [AuthController::class, 'register']);
});

Route::post('/logout', [AuthController::class, 'logout'])->name('logout')->middleware('auth');

// ログアウト後のリダイレクト用
Route::get('/logout', function() {
    return redirect()->route('login')->with('message', '既にログアウトしています。');
})->name('logout.redirect');

// FoxSense One Routes
Route::middleware(['auth'])->group(function () {
    Route::get('/dashboard', [WebController::class, 'dashboard'])->name('dashboard');
    Route::get('/devices', [WebController::class, 'devices'])->name('devices.index');
    Route::post('/devices', [WebController::class, 'storeDevice'])->name('devices.store');
    Route::get('/devices/{id}', [WebController::class, 'deviceDetail'])->name('devices.detail');
    Route::get('/devices/{id}/edit', [WebController::class, 'editDevice'])->name('devices.edit');
    Route::put('/devices/{id}', [WebController::class, 'updateDevice'])->name('devices.update');
    Route::delete('/devices/{id}', [WebController::class, 'deleteDevice'])->name('devices.delete');
    Route::put('/devices/{id}/thresholds', [WebController::class, 'updateDeviceThresholds'])->name('devices.update-thresholds');
    Route::get('/temperature-data', [WebController::class, 'temperatureData'])->name('temperature-data.index');
    Route::get('/temperature-data/export', [WebController::class, 'exportTemperatureData'])->name('temperature-data.export');
    Route::get('/settings', [WebController::class, 'settings'])->name('settings');
    Route::post('/settings', [WebController::class, 'updateSettings'])->name('settings.update');
    Route::get('/emails', [WebController::class, 'emails'])->name('emails.index');
    Route::post('/emails', [WebController::class, 'storeEmail'])->name('emails.store');
    Route::post('/emails/{email}/test', [WebController::class, 'testEmail'])->name('emails.test');
    Route::delete('/emails/{email}', [WebController::class, 'destroyEmail'])->name('emails.destroy');
    
    // Admin only routes
    Route::middleware(['admin'])->group(function () {
        Route::post('/sync-sigfox', [WebController::class, 'syncSigfoxData'])->name('sync.sigfox');
        Route::get('/admin/users', [WebController::class, 'adminUsers'])->name('admin.users');
        Route::get('/admin/users/{id}/edit', [WebController::class, 'editUser'])->name('admin.users.edit');
        Route::put('/admin/users/{id}', [WebController::class, 'updateUser'])->name('admin.users.update');
        Route::delete('/admin/users/{id}', [WebController::class, 'deleteUser'])->name('admin.users.delete');
        Route::delete('/admin/devices/{id}', [WebController::class, 'adminDeleteDevice'])->name('admin.devices.delete');
        Route::delete('/admin/devices/{id}/data', [WebController::class, 'deleteDeviceData'])->name('admin.devices.delete-data');
    });
});
