import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-cambiar-en-produccion',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? '*',
  /// Origen del cliente web, usado para armar links absolutos en emails (ej: reset de contraseña).
  webUrl: process.env.WEB_URL ?? 'http://localhost:5173',
  sendgridApiKey: process.env.SENDGRID_API_KEY || null,
  emailFrom: process.env.EMAIL_FROM ?? 'alertas@myfinance.app',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null,
  remindersCron: process.env.REMINDERS_CRON ?? '0 9 * * *',
  digestsCron: process.env.DIGESTS_CRON ?? '0 9 * * *',
  /// Cron de detección de sugerencias (recurrentes y reglas desde el historial).
  suggestionsCron: process.env.SUGGESTIONS_CRON ?? '30 9 * * *',
  /// API key de Twelve Data — opcional, si falta los precios quedan manuales.
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || null,
  /// Cron de actualización de precios (default 22:30 UTC, post-cierre de Wall Street).
  pricesCron: process.env.PRICES_CRON ?? '30 22 * * *',
  /// Par de forex para la cotización automática del dólar oficial en moneda base.
  twelveDataUsdPair: process.env.TWELVE_DATA_USD_PAIR ?? 'USD/ARS',
  /// data912 (mercado argentino + dólar MEP/CCL) — pública y sin API key, así
  /// que va activa por defecto. `DATA912_ENABLED=false` la apaga.
  data912Enabled: process.env.DATA912_ENABLED !== 'false',
  data912BaseUrl: process.env.DATA912_BASE_URL ?? 'https://data912.com',
};
