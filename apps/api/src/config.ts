import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-cambiar-en-produccion',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? '*',
  sendgridApiKey: process.env.SENDGRID_API_KEY || null,
  emailFrom: process.env.EMAIL_FROM ?? 'alertas@myfinance.app',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null,
  remindersCron: process.env.REMINDERS_CRON ?? '0 9 * * *',
};
