# 💰 MyFinance — Gestión financiera personal

Aplicación de finanzas personales (PFM) **web + móvil** con backend propio.

## Funcionalidades

- ✅ Registro manual de transacciones (ingreso/gasto, monto, categoría, fecha, nota)
- ✅ Categorías personalizables (nombre, color, emoji), con set inicial al registrarse
- ✅ Gastos fijos recurrentes: suscripciones, alquiler, expensas — monto, frecuencia
  (semanal/mensual/anual), día de vencimiento y recordatorio configurable
- ✅ Alertas de pagos próximos por **push (FCM)** y **email (SendGrid)**
- ✅ Dashboard: balance actual, gastos por categoría, comparativa mes a mes, próximos pagos
- ✅ Presupuestos mensuales por categoría con umbral de alerta (1 alerta/mes máx.)
- ✅ Reportes exportables: CSV de transacciones y resumen mensual en PDF
- ✅ Autenticación con JWT (registro/login, preferencias de alertas)
- ⛔ Fuera de alcance (por ahora): conexión bancaria automática (Open Banking)

## Estructura del monorepo

```
├── packages/shared     Tipos TS + cliente API (compartido por web y móvil)
├── apps/api            Backend: Node.js + Express + TypeScript + Prisma + PostgreSQL
├── apps/web            Frontend web: React + TypeScript (Vite) + Recharts
└── apps/mobile         Frontend móvil: React Native (Expo)
```

## Puesta en marcha

Requisitos: Node.js ≥ 20, PostgreSQL 14+ (o Docker).

```bash
# 1. Dependencias (workspaces: shared, api, web)
npm install

# 2. Base de datos local
docker compose up -d          # levanta PostgreSQL en :5432

# 3. Configuración del backend
cp apps/api/.env.example apps/api/.env   # editar JWT_SECRET, DATABASE_URL, etc.

# 4. Migraciones
npm run db:migrate            # prisma migrate dev

# 5. (Opcional) usuario demo con categorías: demo@myfinance.app / demo1234
npm run db:seed

# 6. Levantar API y web
npm run dev:api               # http://localhost:4000
npm run dev:web               # http://localhost:5173 (proxy /api → :4000)
```

### App móvil (Expo)

```bash
cd apps/mobile
npm install
npm start                     # Expo Dev Server (QR para Expo Go)
```

- La URL de la API se configura en `apps/mobile/app.json` → `expo.extra.apiUrl`
  (por defecto `http://10.0.2.2:4000`, el localhost del emulador Android).
- Las notificaciones push nativas requieren un **development build**
  (`npx expo run:android`) y el `google-services.json` de tu proyecto Firebase
  (agregarlo en `app.json` → `expo.android.googleServicesFile`). En Expo Go
  el registro del token se omite silenciosamente.

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | Autenticación (JWT) |
| GET/PATCH | `/api/auth/me` | Perfil y preferencias de alertas |
| CRUD | `/api/categories` | Categorías personalizables |
| CRUD | `/api/transactions` | Transacciones con filtros y paginación |
| CRUD | `/api/recurring` | Gastos fijos + `POST /:id/pay` registra el pago |
| GET/PUT/DELETE | `/api/budgets` | Presupuestos con gasto acumulado del mes |
| GET | `/api/dashboard` | Balance, por categoría, comparativa 6 meses, próximos pagos |
| GET | `/api/reports/transactions.csv` | Export CSV (`?from&to`) |
| GET | `/api/reports/summary.pdf` | Resumen mensual PDF (`?month=YYYY-MM`) |
| POST | `/api/notifications/fcm-token` | Registro del dispositivo para push |
| POST | `/api/notifications/run-reminders` | Dispara el job de recordatorios (pruebas) |

## Notificaciones

Un cron diario (`REMINDERS_CRON`, por defecto 09:00) revisa los gastos fijos y:

1. Avanza vencimientos ya pasados al próximo período.
2. Envía recordatorio (push + email según preferencias del usuario) cuando faltan
   ≤ `reminderDaysBefore` días, una única vez por vencimiento.

Las alertas de presupuesto se evalúan al registrar cada gasto: si el uso del mes
supera el umbral, se notifica (máximo una vez por mes por presupuesto).

**Configuración** (ambos opcionales; si faltan, la funcionalidad se desactiva con un aviso):

- Email: `SENDGRID_API_KEY` + `EMAIL_FROM`
- Push: `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON inline o ruta al archivo de service account)

## Despliegue sugerido

- **Backend**: Railway o Render — build `npm run build -w @myfinance/api`,
  start `npm run start -w @myfinance/api`, aplicar migraciones con
  `npm run db:deploy -w @myfinance/api`.
- **Base de datos**: Supabase o RDS — apuntar `DATABASE_URL`.
- **Web**: build estático (`npm run build -w @myfinance/web` → `apps/web/dist`)
  en Vercel/Netlify/Cloudflare Pages, con `VITE_API_URL` apuntando al backend
  (y `CORS_ORIGIN` del backend apuntando al dominio de la web).
- **Móvil**: EAS Build (`eas build`) para generar binarios de Android/iOS.

## Scripts útiles

```bash
npm run typecheck   # typecheck de shared + api + web
npm run build       # build de producción (api + web)
npm run db:migrate  # prisma migrate dev
```
