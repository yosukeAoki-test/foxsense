export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'A record with this value already exists';
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Zod validation errors（本番環境ではスキーマ詳細を隠す）
  if (err.name === 'ZodError') {
    statusCode = 400;
    message = process.env.NODE_ENV === 'production'
      ? 'Validation failed'
      : err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('Error:', err);
  } else if (statusCode >= 500) {
    // 本番環境では500番台エラーのみサーバーログに出力
    console.error('[Error]', err.message, err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
