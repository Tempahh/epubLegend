import { NextApiRequest, NextApiResponse } from 'next';
import { ValidationError, RateLimitError, NotFoundError } from '../services/utils';

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  retryAfter?: number;
  details?: string;
}

export function handleError(
  err: any,
  _req: NextApiRequest,
  res: NextApiResponse
): void {
  // Log error (in development or external logger in production)
  if (process.env.NODE_ENV === 'development') {
    console.error('[API Error]', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
  }

  // Handle specific error types
  if (err instanceof ValidationError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: 'VALIDATION_ERROR',
    });
  } else if (err instanceof RateLimitError) {
    res.status(429).json({
      success: false,
      error: err.message,
      code: 'RATE_LIMIT',
      retryAfter: err.retryAfter,
    });
  } else if (err instanceof NotFoundError) {
    res.status(404).json({
      success: false,
      error: err.message,
      code: 'NOT_FOUND',
    });
  } else if (err.code === 'RATE_LIMIT') {
    res.status(429).json({
      success: false,
      error: err.message || 'Rate limited',
      code: 'RATE_LIMIT',
      retryAfter: err.retryAfter,
    });
  } else {
    // Generic internal server error
    const errorCode = err.code || 'INTERNAL_ERROR';
    const statusCode = err.statusCode || 500;
    
    res.status(statusCode).json({
      success: false,
      error: 'Internal server error',
      code: errorCode,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

/**
 * Wrap an API handler to catch and handle errors
 */
export function withErrorHandler(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      await handler(req, res);
    } catch (err) {
      handleError(err, req, res);
    }
  };
}
