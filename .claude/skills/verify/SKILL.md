---
name: verify
description: Receta para levantar MyFinance local y verificar cambios de la web end-to-end con Playwright + Chrome del sistema.
---

# Verificar MyFinance (web) end-to-end

## Levantar el stack

```bash
docker compose up -d                       # Postgres :5432
# apps/api/.env debe existir (copiar de apps/api/.env.example; los defaults sirven para local)
cd apps/api && npx prisma migrate dev      # OJO: npm run db:migrate -w falla si falta .env, correr directo para ver el error
npm run db:seed                            # demo@myfinance.app / demo1234 (idempotente)
npm run dev:api                            # :4000 (desde la raíz, en background)
npm run dev:web                            # :5173, proxy /api -> :4000 (background)
```

Salud: `curl http://localhost:4000/api/health` y `curl -I http://localhost:5173`.

## Driver de browser

No hay Playwright en el repo. Instalarlo en el scratchpad (`npm i playwright`) y lanzar
con el Chrome del sistema: `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })`.

Selectores útiles (markup actual):

- Login: `input[type="email"]`, `input[type="password"]`, botón `button.mf-auth-cta` (NO es `type="submit"`).
- Stats del dashboard: `.mf-hero-stats > div` con hijos `.mf-stat-label` / `.mf-stat-value` (labels "Ingresos · …", "Gastos · …").
- Botón global de alta: `.mf-add-btn` (modal "Nuevo movimiento", input de monto dentro del label "Monto", submit `button:has-text("Guardar movimiento")`).
- Los borrados usan `confirm()`: registrar `page.on('dialog', d => d.accept())`.
- Montos es-AR sin decimales: parsear con `Number(text.replace(/[^\d-]/g, ''))`.

## Trucos

- Para detectar reloads no deseados: setear `window.__marker` y contar eventos `load`; en una SPA sana quedan en 0 tras el login.
- Dejar la DB demo limpia: borrar desde la UI los movimientos de prueba (monto distintivo tipo 111111 hace fácil ubicarlos).
