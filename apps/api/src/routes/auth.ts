import { DigestFrequency } from '@prisma/client';
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { generateResetToken, hashResetToken, isResetTokenValid } from '../lib/passwordReset';
import { RateLimiter } from '../lib/rateLimiter';
import { serialize } from '../lib/serialize';
import { requireAuth, signToken } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';
import { sendPasswordResetEmail } from '../services/notifications';

const router = Router();

const PASSWORD_MIN_MESSAGE = 'La contraseña debe tener al menos 8 caracteres';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, PASSWORD_MIN_MESSAGE),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, PASSWORD_MIN_MESSAGE),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, PASSWORD_MIN_MESSAGE),
});

/** Mensaje genérico: nunca revela si el email existe o no. */
const FORGOT_PASSWORD_MESSAGE = 'Si el email existe en MyFinance, vas a recibir un link para restablecer tu contraseña.';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

/** Máx 3 solicitudes de recuperación por email por hora. */
const forgotPasswordLimiter = new RateLimiter(3, RESET_TOKEN_TTL_MS);

const DEFAULT_CATEGORIES: Array<{ name: string; color: string; icon: string; type: 'INCOME' | 'EXPENSE' }> = [
  { name: 'Alimentación', color: '#f59e0b', icon: '🍽️', type: 'EXPENSE' },
  { name: 'Transporte', color: '#3b82f6', icon: '🚌', type: 'EXPENSE' },
  { name: 'Vivienda', color: '#8b5cf6', icon: '🏠', type: 'EXPENSE' },
  { name: 'Servicios', color: '#06b6d4', icon: '💡', type: 'EXPENSE' },
  { name: 'Suscripciones', color: '#ec4899', icon: '📺', type: 'EXPENSE' },
  { name: 'Ocio', color: '#f97316', icon: '🎉', type: 'EXPENSE' },
  { name: 'Otros gastos', color: '#6b7280', icon: '📦', type: 'EXPENSE' },
  { name: 'Sueldo', color: '#22c55e', icon: '💼', type: 'INCOME' },
  { name: 'Otros ingresos', color: '#14b8a6', icon: '➕', type: 'INCOME' },
];

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  emailAlerts: boolean;
  pushAlerts: boolean;
  digestFrequency: DigestFrequency;
  baseCurrency: string;
  createdAt: Date;
}) {
  const { id, email, name, emailAlerts, pushAlerts, digestFrequency, baseCurrency, createdAt } = user;
  return serialize({ id, email, name, emailAlerts, pushAlerts, digestFrequency, baseCurrency, createdAt });
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new HttpError(409, 'Ya existe una cuenta con ese email');

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        categories: { create: DEFAULT_CATEGORIES },
        accounts: { create: { name: 'Efectivo', type: 'CASH', isDefault: true } },
      },
    });
    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: publicUser(user) });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }
    const token = signToken({ userId: user.id, email: user.email });
    res.json({ token, user: publicUser(user) });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!matches) throw new HttpError(401, 'La contraseña actual es incorrecta');

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ message: 'Contraseña actualizada correctamente.' });
  }),
);

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const input = forgotPasswordSchema.parse(req.body);

    // Nunca se filtra si el request pasó el rate limit o no: siempre la misma respuesta.
    if (forgotPasswordLimiter.attempt(input.email)) {
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (user) {
        const token = generateResetToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashResetToken(token),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          },
        });
        const resetUrl = `${config.webUrl}/reset?token=${token}`;
        await sendPasswordResetEmail(user.email, resetUrl);
      }
    }

    res.json({ message: FORGOT_PASSWORD_MESSAGE });
  }),
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    const tokenHash = hashResetToken(input.token);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || !isResetTokenValid(record)) {
      throw new HttpError(400, 'El link de recuperación es inválido o expiró');
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      // Invalida todos los tokens vivos del usuario (incluido este), no solo el usado.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);

    res.json({ message: 'Contraseña actualizada correctamente. Ya podés iniciar sesión.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw new HttpError(404, 'Usuario no encontrado');
    res.json(publicUser(user));
  }),
);

const prefsSchema = z.object({
  emailAlerts: z.boolean().optional(),
  pushAlerts: z.boolean().optional(),
  digestFrequency: z.nativeEnum(DigestFrequency).optional(),
  name: z.string().min(1).max(100).optional(),
  /** Moneda base para consolidar totales (código libre; la UI ofrece ARS/USD). */
  baseCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}$/, 'Código de moneda inválido')
    .transform((s) => s.toUpperCase())
    .optional(),
});

router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = prefsSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: input });
    res.json(publicUser(user));
  }),
);

export default router;
