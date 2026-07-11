import sgMail from '@sendgrid/mail';
import * as admin from 'firebase-admin';
import fs from 'fs';
import { config } from '../config';
import { prisma } from '../prisma';

let sendgridReady = false;
if (config.sendgridApiKey) {
  sgMail.setApiKey(config.sendgridApiKey);
  sendgridReady = true;
} else {
  console.warn('[notifications] SENDGRID_API_KEY no configurada — emails deshabilitados');
}

let fcmReady = false;
if (config.firebaseServiceAccountJson) {
  try {
    const raw = config.firebaseServiceAccountJson.trim().startsWith('{')
      ? config.firebaseServiceAccountJson
      : fs.readFileSync(config.firebaseServiceAccountJson, 'utf-8');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    fcmReady = true;
  } catch (err) {
    console.error('[notifications] No se pudo inicializar Firebase Admin:', err);
  }
} else {
  console.warn('[notifications] FIREBASE_SERVICE_ACCOUNT_JSON no configurada — push deshabilitado');
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!sendgridReady) return;
  try {
    await sgMail.send({ to, from: config.emailFrom, subject, html });
  } catch (err) {
    console.error(`[notifications] Error enviando email a ${to}:`, err);
  }
}

export async function sendPushToUser(userId: string, title: string, body: string): Promise<void> {
  if (!fcmReady) return;
  const tokens = await prisma.fcmToken.findMany({ where: { userId } });
  if (tokens.length === 0) return;
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title, body },
    });
    // Limpia tokens inválidos (app desinstalada, token rotado)
    const invalid: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
        invalid.push(tokens[i].token);
      }
    });
    if (invalid.length > 0) {
      await prisma.fcmToken.deleteMany({ where: { token: { in: invalid } } });
    }
  } catch (err) {
    console.error('[notifications] Error enviando push:', err);
  }
}

/** Email transaccional de recuperación de contraseña. Ignora emailAlerts (no es una alerta opcional). */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!config.sendgridApiKey) {
    console.warn(
      `[notifications] SendGrid no configurado — no se envió el email de reset a ${to}. Link: ${resetUrl}`,
    );
  }
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111827">
      <h2 style="margin:0 0 12px">Recuperá tu contraseña</h2>
      <p style="margin:0 0 20px;color:#6b7280">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta en MyFinance.
        Si fuiste vos, hacé clic en el siguiente botón. El link vence en 1 hora.
      </p>
      <p style="text-align:center;margin:0 0 20px">
        <a href="${resetUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Restablecer contraseña
        </a>
      </p>
      <p style="margin:0;color:#9ca3af;font-size:13px">
        Si no pediste este cambio, podés ignorar este email — tu contraseña actual sigue funcionando.
      </p>
    </div>
  `;
  await sendEmail(to, 'Recuperá tu contraseña — MyFinance', html);
}

export interface NotifyInput {
  title: string;
  body: string;
  emailHtml?: string;
}

/** Envía push + email según las preferencias del usuario. */
export async function notifyUser(userId: string, input: NotifyInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const tasks: Promise<void>[] = [];
  if (user.pushAlerts) {
    tasks.push(sendPushToUser(userId, input.title, input.body));
  }
  if (user.emailAlerts) {
    tasks.push(
      sendEmail(user.email, input.title, input.emailHtml ?? `<p>${input.body}</p>`),
    );
  }
  await Promise.all(tasks);
}
