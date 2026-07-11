import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { generateResetToken, hashResetToken, isResetTokenValid } from './passwordReset';

describe('hashResetToken', () => {
  it('devuelve el sha256 hex del token', () => {
    const token = 'abc123';
    const expected = crypto.createHash('sha256').update(token).digest('hex');
    expect(hashResetToken(token)).toBe(expected);
  });

  it('es determinístico: el mismo token siempre da el mismo hash', () => {
    expect(hashResetToken('mismo-token')).toBe(hashResetToken('mismo-token'));
  });

  it('tokens distintos dan hashes distintos', () => {
    expect(hashResetToken('token-a')).not.toBe(hashResetToken('token-b'));
  });
});

describe('generateResetToken', () => {
  it('genera un token hex de 64 caracteres (32 bytes)', () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no repite tokens entre llamadas', () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });
});

describe('isResetTokenValid', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');

  it('es válido si no expiró y no fue usado', () => {
    const record = { expiresAt: new Date('2026-07-10T13:00:00.000Z'), usedAt: null };
    expect(isResetTokenValid(record, now)).toBe(true);
  });

  it('es inválido si ya expiró', () => {
    const record = { expiresAt: new Date('2026-07-10T11:00:00.000Z'), usedAt: null };
    expect(isResetTokenValid(record, now)).toBe(false);
  });

  it('es inválido justo en el instante de expiración (borde exclusivo)', () => {
    const record = { expiresAt: now, usedAt: null };
    expect(isResetTokenValid(record, now)).toBe(false);
  });

  it('es inválido si ya fue usado, aunque no haya expirado', () => {
    const record = {
      expiresAt: new Date('2026-07-10T13:00:00.000Z'),
      usedAt: new Date('2026-07-10T11:30:00.000Z'),
    };
    expect(isResetTokenValid(record, now)).toBe(false);
  });
});
