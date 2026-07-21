import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }

  console.error(err);
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(status).json({ error: message });
}
