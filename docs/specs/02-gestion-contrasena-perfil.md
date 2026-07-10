# 02 — Gestión de contraseña y perfil

**Esfuerzo:** M · **Dependencias:** SendGrid configurado (`SENDGRID_API_KEY`) para el reset por email

## Contexto

Hoy no existe ni cambio ni recuperación de contraseña: sin endpoints, sin UI (verificado por grep de `forgot`/`reset-password`/`changePassword`). Para una app desplegada, olvido de contraseña = cuenta perdida — riesgo operativo. Además, `PATCH /api/auth/me` ya acepta `name` (`auth.ts:93-108`) pero Preferencias lo muestra solo lectura.

## Alcance

### 1. Cambio de contraseña (sesión activa)

- `POST /api/auth/change-password` — body `{ currentPassword, newPassword }` (zod: `newPassword` ≥8, igual criterio que registro). Verifica `currentPassword` con bcrypt; si no coincide → 401 con mensaje claro. Actualiza el hash.
- UI: sección "Seguridad" en `SettingsPage` con los dos campos + confirmación de nueva contraseña (validación solo en cliente).

### 2. Recuperación por email

- Nuevo modelo Prisma `PasswordResetToken`: `id`, `userId`, `tokenHash` (sha256 del token, nunca el token en claro), `expiresAt` (+1 h), `usedAt` nullable. Migración.
- `POST /api/auth/forgot-password` — body `{ email }`. **Siempre responde 200** con el mismo mensaje, exista o no el email (no filtrar existencia de cuentas). Si existe: genera token aleatorio (32 bytes), guarda el hash, envía email vía `services/notifications.ts` con link `${WEB_URL}/reset?token=...`. Nueva var `WEB_URL` en `config.ts`. Rate-limit simple en memoria: máx 3 requests por email por hora.
- `POST /api/auth/reset-password` — body `{ token, newPassword }`. Valida hash + expiración + no usado; actualiza contraseña, marca `usedAt`, invalida los demás tokens vivos del usuario.
- Web: link "¿Olvidaste tu contraseña?" en `AuthPage` (modo login) → form de email; ruta `/reset` que lee `?token=` y pide la nueva contraseña.
- Si SendGrid no está configurado: el endpoint responde 200 igual pero loguea warning (consistente con el patrón no-op de `services/notifications.ts`); documentar que en ese caso el reset no es operativo.

### 3. Perfil editable

- `SettingsPage`: campo nombre editable → `PATCH /api/auth/me` (ya soportado, cero cambio de API).

## Cambios concretos

- `apps/api/prisma/schema.prisma` + migración (`PasswordResetToken`).
- `apps/api/src/routes/auth.ts` — 3 endpoints nuevos.
- `apps/api/src/config.ts` — `WEB_URL`.
- `apps/api/src/services/notifications.ts` — template de email de reset.
- `apps/web/src/pages/AuthPage.tsx` — link + form olvido; nueva vista/ruta `/reset` en `App.tsx`.
- `apps/web/src/pages/SettingsPage.tsx` — sección seguridad + nombre editable.
- `packages/shared/src/api.ts` + `types.ts` — métodos `changePassword`, `forgotPassword`, `resetPassword`.

## Testing

Manual:
- Cambio con contraseña actual incorrecta → 401, mensaje en UI.
- Flujo completo de reset con email real (o log del link en dev): token usado dos veces → segunda vez falla; token de +1 h → expirado.
- `forgot-password` con email inexistente → misma respuesta que con existente.
- JWT emitidos antes del cambio siguen siendo válidos (limitación conocida, ver Fuera de alcance).

## Fuera de alcance

- Invalidación de JWT vigentes al cambiar contraseña (requeriría versionado de token o blacklist — anotar como deuda).
- Verificación de email en el registro.
- Gestión de sesiones/dispositivos.
- 2FA.
