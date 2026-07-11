import crypto from 'crypto';

/** Token aleatorio (32 bytes = 64 chars hex) enviado al usuario por email. Nunca se persiste en claro. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** sha256 hex del token — lo único que se guarda en `PasswordResetToken.tokenHash`. */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface ResetTokenRecord {
  expiresAt: Date;
  usedAt: Date | null;
}

/** Un token es válido si no fue usado todavía y no expiró (comparado contra `now`). */
export function isResetTokenValid(record: ResetTokenRecord, now: Date = new Date()): boolean {
  if (record.usedAt) return false;
  return record.expiresAt.getTime() > now.getTime();
}
