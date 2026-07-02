import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.auth = { userId: payload.userId, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
