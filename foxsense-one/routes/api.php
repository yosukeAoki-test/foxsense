<?php

use App\Http\Controllers\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Sigfox Callback Endpoint with rate limiting
Route::post('/sigfox/callback', [ApiController::class, 'sigfoxCallback'])
    ->name('api.sigfox.callback')
    ->middleware('throttle:sigfox');