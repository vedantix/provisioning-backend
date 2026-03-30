export class AppError extends Error {
    statusCode: number;
    code: string;
    details?: Record<string, unknown>;
  
    constructor(
      message: string,
      statusCode = 500,
      code = 'INTERNAL_ERROR',
      details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'AppError';
      this.statusCode = statusCode;
      this.code = code;
      this.details = details;
    }
  }
  
  export class BadRequestError extends AppError {
    constructor(message: string, details?: Record<string, unknown>) {
      super(message, 400, 'BAD_REQUEST', details);
      this.name = 'BadRequestError';
    }
  }
  
  export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', details?: Record<string, unknown>) {
      super(message, 401, 'UNAUTHORIZED', details);
      this.name = 'UnauthorizedError';
    }
  }
  
  export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', details?: Record<string, unknown>) {
      super(message, 403, 'FORBIDDEN', details);
      this.name = 'ForbiddenError';
    }
  }
  
  export class NotFoundError extends AppError {
    constructor(message = 'Not found', details?: Record<string, unknown>) {
      super(message, 404, 'NOT_FOUND', details);
      this.name = 'NotFoundError';
    }
  }
  
  export class ConflictHttpError extends AppError {
    constructor(message: string, details?: Record<string, unknown>) {
      super(message, 409, 'CONFLICT', details);
      this.name = 'ConflictHttpError';
    }
  }
  
  export class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests', details?: Record<string, unknown>) {
      super(message, 429, 'TOO_MANY_REQUESTS', details);
      this.name = 'TooManyRequestsError';
    }
  }