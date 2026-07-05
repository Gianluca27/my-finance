import { Router } from 'express';
import { z } from 'zod';
import { runDigestsJob } from '../jobs/digests';
import { runRemindersJob } from '../jobs/reminders';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { prisma } from '../prisma';

const router = Router();
router.use(requireAuth);

const fcmSchema = z.object({
  token: z.string().min(10),
  platform: z.string().max(20).optional(),
});

/** Registra el token FCM del dispositivo para recibir push. */
router.post(
  '/fcm-token',
  asyncHandler(async (req, res) => {
    const input = fcmSchema.parse(req.body);
    await prisma.fcmToken.upsert({
      where: { token: input.token },
      update: { userId: req.auth!.userId, platform: input.platform },
      create: { token: input.token, platform: input.platform, userId: req.auth!.userId },
    });
    res.json({ ok: true });
  }),
);

/** Dispara el job de recordatorios manualmente (útil para pruebas). */
router.post(
  '/run-reminders',
  asyncHandler(async (_req, res) => {
    const result = await runRemindersJob();
    res.json(result);
  }),
);

/** Dispara el job de resúmenes por email manualmente, forzando el envío (útil para pruebas). */
router.post(
  '/run-digests',
  asyncHandler(async (_req, res) => {
    const result = await runDigestsJob({ force: true });
    res.json(result);
  }),
);

export default router;
