import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import { serialize } from '../lib/serialize';
import { requireAuth, signToken } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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
  createdAt: Date;
}) {
  const { id, email, name, emailAlerts, pushAlerts, createdAt } = user;
  return serialize({ id, email, name, emailAlerts, pushAlerts, createdAt });
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
  name: z.string().min(1).max(100).optional(),
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
