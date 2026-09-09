import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(`[ERROR] ${err.name}: ${err.message}`);

  // Multer upload errors (wrong field name, file too large, etc.)
  if (err.name === 'MulterError') {
    const multerErr = err as any;
    const message = multerErr.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Max size is 10MB.'
      : multerErr.code === 'LIMIT_UNEXPECTED_FILE'
      ? 'Unexpected upload field. Please retry.'
      : `Upload failed: ${multerErr.message}`;
    return res.status(400).json({ success: false, error: message, code: multerErr.code });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    if (prismaErr.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'A record with this value already exists.',
        code: 'DUPLICATE',
      });
    }
    if (prismaErr.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: 'Record not found.',
        code: 'NOT_FOUND',
      });
    }
  }

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error. Please try again.'
      : err.message,
    message: err.message,  // always include for debugging
    code: 'INTERNAL_ERROR',
  });
}
