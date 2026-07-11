# Guía de deploy: Vercel (web) + Railway (API + Postgres)

Monorepo con npm workspaces: `packages/shared` (tipos + cliente API, se consume
como TS fuente, sin build propio), `apps/api` (Express/Prisma) y `apps/web`
(Vite/React). El deploy usa dos servicios independientes que solo se conectan
por HTTP:

- **Railway**: Postgres + API (`apps/api`)
- **Vercel**: sitio estático (`apps/web`)

---

## 0. Antes de empezar

- Repo pusheado a GitHub (Railway y Vercel se conectan por repo, no por CLI
  local, aunque ambos tienen CLI si preferís ese flujo).
- Generá un `JWT_SECRET` fuerte para producción (no reuses el de `.env` local):

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

---

## 1. Backend en Railway

### 1.1 Crear proyecto + Postgres

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → elegí este repo.
2. En el mismo proyecto: **New** → **Database** → **Add PostgreSQL**.
   Railway crea el servicio `Postgres` con su propio `DATABASE_URL` interno.

### 1.2 Configurar el servicio de la API (monorepo)

El repo es un workspace raíz con 3 paquetes, así que **no** dejes que Railway
adivine el build. Andá al servicio de la API → **Settings**:

| Campo | Valor |
|---|---|
| Root Directory | `/` (raíz del repo, no `apps/api`) |
| Build Command | `npm run build -w @myfinance/shared && npm run build -w @myfinance/api` |
| Start Command | `npm run db:deploy -w @myfinance/api && npm run start -w @myfinance/api` |

Por qué Root Directory = `/`: `npm install` necesita ver el `package.json` raíz
con el campo `workspaces` para linkear `@myfinance/shared` dentro de
`node_modules`. Si apuntás Root Directory a `apps/api`, el install no resuelve
ese paquete y el build de Prisma/tsc falla.

El Start Command corre `prisma migrate deploy` en cada deploy antes de
levantar el server — es idempotente, así que es seguro dejarlo siempre ahí en
vez de correr migraciones a mano.

### 1.3 Variables de entorno

En el servicio de la API → **Variables**:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}   # referencia al plugin de Postgres
JWT_SECRET=<el que generaste en el paso 0>
JWT_EXPIRES_IN=7d
PORT=4000                                  # Railway inyecta su propio $PORT igual; dejalo, config.ts lo respeta
CORS_ORIGIN=https://TU-APP.vercel.app      # lo ajustás en el paso 3, por ahora poné algo
WEB_URL=https://tu-proyecto.vercel.app     # lo ajustás en el paso 3; arma el link de los emails de reset de contraseña (si falta, cae en http://localhost:5173)
REMINDERS_CRON=0 9 * * *

# Opcionales — si faltan, esas features se desactivan solas
SENDGRID_API_KEY=
EMAIL_FROM=alertas@myfinance.app
FIREBASE_SERVICE_ACCOUNT_JSON=
```

`${{Postgres.DATABASE_URL}}` es la sintaxis de Railway para referenciar la
variable de otro servicio del mismo proyecto — se resuelve sola, no la
edites a mano.

### 1.4 Deploy y verificación

Railway redeploya solo al detectar la config. Una vez que el servicio esté
"Active":

- Anotá la URL pública (**Settings → Networking → Generate Domain** si no
  tiene una todavía). Ejemplo: `https://myfinance-api.up.railway.app`.
- Probá: `curl https://TU-API.up.railway.app/api/dashboard` (debería dar 401,
  no un error de conexión — confirma que el server levantó).
- Revisá logs del deploy para confirmar que `prisma migrate deploy` corrió sin
  errores.
- (Opcional) `npm run db:seed` no corre en producción por defecto — si querés
  el usuario demo ahí, usá `railway run npm run db:seed -w @myfinance/api`
  desde tu máquina con la Railway CLI conectada al proyecto.

---

## 2. Frontend en Vercel

### 2.1 Importar el proyecto

1. [vercel.com/new](https://vercel.com/new) → importá el mismo repo de GitHub.
2. Vercel detecta el monorepo. En **Configure Project**:

| Campo | Valor |
|---|---|
| Root Directory | `apps/web` |
| Framework Preset | Vite |
| Build Command | `npm run build` (default de Vite preset ya sirve) |
| Output Directory | `dist` (default) |
| Install Command | dejar el default — Vercel detecta `workspaces` en el `package.json` raíz y instala ahí automáticamente |

No hace falta tocar Install Command a mano: Vercel ya soporta npm workspaces
y sube un nivel para instalar cuando ve `workspaces` en la raíz. Si en algún
build ves errores de "Cannot find module '@myfinance/shared'", activá
**Settings → General → "Include files outside the root directory"**.

### 2.2 Variable de entorno

**Settings → Environment Variables**:

```bash
VITE_API_URL=https://TU-API.up.railway.app
```

Sin barra final. `apps/web/src/api.ts` la lee vía `import.meta.env.VITE_API_URL`
para armar el `baseUrl` del cliente HTTP — sin esto, el front pega a rutas
relativas y en producción (dominios distintos) eso rompe.

### 2.3 SPA routing (`vercel.json`)

`apps/web` usa `BrowserRouter` (`src/main.tsx`), que depende de rutas tipo
`/login` o `/dashboard` resueltas por el cliente. Sin esto, Vercel devuelve
404 en cualquier ruta que no sea `/` porque no existe un archivo físico ahí.
Ya está agregado en `apps/web/vercel.json`:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Con Root Directory = `apps/web`, Vercel lo detecta solo. No hace falta tocar
nada en el dashboard para esto.

### 2.4 Deploy

**Deploy**. Vercel te da la URL final (`https://tu-proyecto.vercel.app`).

---

## 3. Conectar los dos servicios

Volvé a Railway → variables de la API → actualizá:

```bash
CORS_ORIGIN=https://tu-proyecto.vercel.app
WEB_URL=https://tu-proyecto.vercel.app
```

`WEB_URL` es la que arma el link de los emails de reset de contraseña
(`${WEB_URL}/reset?token=...` en `routes/auth.ts`); si no la seteás, cae en
`http://localhost:5173` y los emails de producción quedan apuntando a
localhost.

Soporta múltiples orígenes separados por coma (`config.ts` hace `.split(',')`),
útil si además tenés un dominio custom o preview deployments de Vercel:

```bash
CORS_ORIGIN=https://tu-proyecto.vercel.app,https://app.tudominio.com
```

Redeployá la API para que tome el cambio (Railway lo hace solo al guardar la
variable).

---

## 4. Checklist post-deploy

- [ ] `POST /api/auth/register` funciona desde el sitio de Vercel (confirma
      CORS + `VITE_API_URL` + DB correctos a la vez)
- [ ] Login persiste el JWT y el dashboard carga datos
- [ ] Logs de Railway sin errores de Prisma/conexión a DB
- [ ] Si configuraste SendGrid/Firebase: probar
      `POST /api/notifications/run-reminders` y revisar que no tire warning de
      "feature desactivada"

---

## 5. Notas sueltas

- **Dominio propio**: en Vercel, Settings → Domains. En Railway, Settings →
  Networking → Custom Domain (te da un CNAME). Actualizá `CORS_ORIGIN` y
  `VITE_API_URL` en consecuencia y volvé a deployar ambos lados.
- **Preview deployments de Vercel**: cada PR genera una URL tipo
  `proyecto-git-branch.vercel.app`. Si necesitás que esas previews también
  puedan hablar con la API, vas a tener que agregarlas a `CORS_ORIGIN` (o
  aflojar a un wildcard vía código, no soportado hoy en `config.ts`).
- **App móvil (Expo)**: no forma parte de este deploy. Apunta
  `apps/mobile/app.json → expo.extra.apiUrl` a la misma URL de Railway y se
  buildea aparte con `eas build`.
- **Rollback**: tanto Railway como Vercel guardan deploys anteriores — "Redeploy"
  o "Rollback" desde su dashboard, no hace falta revertir el commit.
