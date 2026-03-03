<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            \App\Http\Middleware\VerifyCsrfToken::class,
        ]);
        
        $middleware->alias([
            'admin' => \App\Http\Middleware\IsAdmin::class,
            'guest' => \App\Http\Middleware\RedirectIfAuthenticated::class,
        ]);
        
        // Rate limiting for Sigfox callbacks
        $middleware->throttleWith([
            'sigfox' => \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class.':1000,1', // 1000 requests per minute
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
