# Mobile: Inversiones (fase 1) + polish de Registro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los dos gaps reales que quedan de `docs/specs/18-mobile-paridad.md` — pantalla de Inversiones (solo lectura) en mobile, y el polish pendiente de Registro (validación de contraseña + link "¿Olvidaste tu contraseña?").

**Architecture:** Todo el trabajo es `apps/mobile`, cero cambios de API ni de `@myfinance/shared` — reusa `ApiClient` existente. `InvestmentsScreen.tsx` sigue el patrón de archivo único con estado propio (`useFocusEffect` + `useState`, sin hook de caché) que ya usan `DebtsScreen.tsx`/`SuggestionsScreen.tsx`; el gráfico de precio reutiliza `react-native-svg` a mano, igual que `DashboardScreen.tsx` y el equivalente web `InvestmentsPage.tsx`.

**Tech Stack:** React Native (Expo), TypeScript, `@react-navigation/native-stack`, `react-native-svg`, `@myfinance/shared` (`ApiClient`, tipos).

## Global Constraints

- Todo copy nuevo (UI, mensajes de error) en español, tono consistente con el resto de la app.
- No tocar `packages/shared` ni `apps/api` — todos los métodos y tipos ya existen (`listInvestments`, `getInvestment`, `getInvestmentPriceHistory`, `register`, `forgotPassword`).
- Seguir el patrón de pantalla existente: `useTheme()` + `createStyles(colors)` con `StyleSheet.create`, sin theme claro.
- `apps/mobile` no tiene test runner (confirmado: solo `apps/api` corre Vitest). La verificación de cada tarea es `npm run typecheck -w apps/mobile` (`tsc --noEmit`) más un smoke manual por Expo — no hay pasos de "escribí el test que falla".
- No portar alta de activos/operaciones ni pull-to-refresh de precios (fase 2, fuera de alcance explícito de la spec 18).
- `SuggestionsScreen.tsx` ya existe, está wireado en `navItems.ts`/`App.tsx` y no requiere cambios — no crear un archivo nuevo para eso.

---

## Contexto descubierto (importante, difiere de la spec original)

La spec 18 quedó desactualizada — verificado leyendo el código actual, no solo el doc:

- **Sugerencias (item 3 de la spec)**: ya está 100% construida y en `navItems.ts`/`App.tsx` (`apps/mobile/src/screens/SuggestionsScreen.tsx`). Nada que hacer.
- **Registro (item 1)**: ya existe como toggle `mode: 'login'|'register'` dentro de `LoginScreen.tsx` (no un archivo separado), y ya llama a `register()` del `AuthProvider`. Falta solo: (a) validación de contraseña ≥8 en el submit, (b) el link "¿Olvidaste tu contraseña?" (spec 02 está implementada: `api.forgotPassword`/`api.resetPassword` existen y la web los usa en `/login`).
- **Inversiones (item 2)**: genuinamente no existe nada en mobile. Es el trabajo real de este plan.
- **Specs 14/15 (TIR, histórico de precios, renta) ya están implementadas** en API/shared/web — la dependencia que anotaba la spec 18 ("mejor después de 14/15") está satisfecha.

---

### Task 1: Ícono `IcoTrend` en mobile

**Files:**
- Modify: `apps/mobile/src/components/icons.tsx`

**Interfaces:**
- Produces: `export const IcoTrend: (p: IconProps) => React.ReactElement` — mismo shape que el resto de los íconos del archivo (`IcoDoc`, `IcoTag`, etc.), consumido por Task 3 en `navItems.ts`.

- [ ] **Step 1: Agregar el ícono**

En `apps/mobile/src/components/icons.tsx`, insertar después de la definición de `IcoDoc` (línea 78, justo antes de `IcoPlus`):

```tsx
export const IcoTrend = (p: IconProps) => (
  <PathIcon {...p} paths={[{ d: 'M3 16l4.5-5 3 3L16 7' }, { d: 'M12.5 6.5H16V10' }]} />
);
```

Es el mismo path que ya usa la web en `apps/web/src/components/icons.tsx:59-61` — portado 1:1, como el resto de los íconos de este archivo.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @myfinance/mobile`
Expected: 0 errores (el ícono no se usa todavía en ningún lado, así que no puede fallar por uso).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/icons.tsx
git commit -m "feat(mobile): agrega ícono IcoTrend para Inversiones"
```

---

### Task 2: Registro — validación de contraseña + link "¿Olvidaste tu contraseña?"

**Files:**
- Modify: `apps/mobile/src/api.ts`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/src/screens/LoginScreen.tsx`

**Interfaces:**
- Produces: `export const webUrl: string` en `apps/mobile/src/api.ts` (mismo patrón que `baseUrl`), usado por `LoginScreen.tsx` para armar la URL del link.

- [ ] **Step 1: Exponer `webUrl` en `api.ts`**

En `apps/mobile/src/api.ts`, después de la definición de `baseUrl` (línea 22-22), agregar:

```ts
export const webUrl: string =
  (Constants.expoConfig?.extra?.webUrl as string | undefined) ?? 'http://localhost:5173';
```

- [ ] **Step 2: Configurar `webUrl` en `app.json`**

En `apps/mobile/app.json`, dentro de `expo.extra` (línea 18-20), agregar la clave junto a `apiUrl`:

```json
    "extra": {
      "apiUrl": "http://192.168.68.110:4000",
      "webUrl": "http://192.168.68.110:5173"
    }
```

(Mismo host LAN que ya usa `apiUrl` para dev local — `apps/web` corre en `:5173` según `npm run dev:web`.)

- [ ] **Step 3: Validación de contraseña + link en `LoginScreen.tsx`**

En `apps/mobile/src/screens/LoginScreen.tsx`:

Agregar `Linking` al import de `react-native` (línea 2-9) y el import de `webUrl`:

```tsx
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth';
import { webUrl } from '../api';
import { Field, Input, PrimaryButton } from '../components/ui';
```

Reemplazar `onSubmit` (línea 31-42) para validar contraseña antes de llamar a la API:

```tsx
  async function onSubmit() {
    setError(null);
    if (mode === 'register' && password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }
```

Agregar el link de "¿Olvidaste tu contraseña?" justo después del `Field` de Contraseña (línea 91-93) y antes del botón:

```tsx
          <Field label="Contraseña">
            <Input value={password} onChangeText={setPassword} secureTextEntry />
          </Field>

          {mode === 'login' && (
            <Text style={styles.forgotLink} onPress={() => Linking.openURL(`${webUrl}/login`)}>
              ¿Olvidaste tu contraseña?
            </Text>
          )}

          <View style={{ marginTop: spacing.xs }}>
            <PrimaryButton label={cta} onPress={onSubmit} busy={busy} />
          </View>
```

Agregar el estilo `forgotLink` en `createStyles` (dentro del objeto que retorna `StyleSheet.create`, junto a `switchLink` en línea 155):

```tsx
    forgotLink: {
      color: colors.accent,
      fontFamily: fonts.medium,
      fontSize: 13,
      textAlign: 'right',
      marginTop: -4,
    },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @myfinance/mobile`
Expected: 0 errores.

- [ ] **Step 5: Smoke manual (Expo)**

- Modo registro: intentar crear cuenta con contraseña de 5 caracteres → error "La contraseña debe tener al menos 8 caracteres." sin pegarle a la API.
- Modo login: tocar "¿Olvidaste tu contraseña?" → abre el navegador/webview del sistema en `{webUrl}/login` (con la web corriendo en `:5173`, cae en el toggle de "olvidé mi contraseña" del `AuthPage`).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/api.ts apps/mobile/app.json apps/mobile/src/screens/LoginScreen.tsx
git commit -m "feat(mobile): valida contraseña de registro y agrega link de recuperación"
```

---

### Task 3: `InvestmentsScreen` — resumen + lista (solo lectura), wireada a la navegación

**Depends on:** Task 1 (`IcoTrend`).

**Files:**
- Create: `apps/mobile/src/screens/InvestmentsScreen.tsx`
- Modify: `apps/mobile/src/components/ui.tsx` (agrega `caption` opcional a `SummaryTile`)
- Modify: `apps/mobile/src/navItems.ts`
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `api.listInvestments(): Promise<InvestmentsOverview>` (`packages/shared/src/api.ts:357`); tipos `Investment`, `InvestmentsOverview`, `InvestmentType` de `@myfinance/shared`; `SummaryTile`, `Card`, `EmptyState`, `ErrorText`, `MutedText` de `../components/ui`; `IcoTrend` de `../components/icons` (Task 1).
- Produces: `export function InvestmentsScreen()` — consumido por `App.tsx` (`SCREENS.Inversiones`). Helpers locales al archivo (no exportados, Task 4 los reutiliza en el mismo archivo): `formatQty`, `formatAsset`, `formatPrice`, `formatTir`, `pnlColor(pnl, colors)`, `TYPE_LABELS`, `TYPE_FALLBACK_ICON`.

- [ ] **Step 1: Agregar `caption` opcional a `SummaryTile`**

En `apps/mobile/src/components/ui.tsx`, reemplazar la función `SummaryTile` (líneas 60-85) por:

```tsx
export function SummaryTile({
  label,
  value,
  tone = 'default',
  caption,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'income' | 'expense' | 'good' | 'critical';
  caption?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => baseStyles(colors), [colors]);
  const toneColor =
    tone === 'income' || tone === 'good'
      ? colors.deltaGood
      : tone === 'expense'
        ? colors.expense
        : tone === 'critical'
          ? colors.critical
          : colors.textPrimary;
  return (
    <View style={[s.card, { flex: 1 }]}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, { color: toneColor }]}>{value}</Text>
      {caption ? <Text style={{ color: colors.textMuted, fontSize: 11.5, marginTop: 2 }}>{caption}</Text> : null}
    </View>
  );
}
```

`caption` es opcional — `DebtsScreen.tsx` sigue funcionando sin cambios.

- [ ] **Step 2: Crear `InvestmentsScreen.tsx`**

Crear `apps/mobile/src/screens/InvestmentsScreen.tsx` con este contenido completo:

```tsx
import type { Investment, InvestmentsOverview, InvestmentType } from '@myfinance/shared';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import { Card, EmptyState, ErrorText, MutedText, SummaryTile } from '../components/ui';

const TYPE_LABELS: Record<InvestmentType, string> = {
  ACCION: 'Acción',
  ETF: 'ETF',
  CEDEAR: 'CEDEAR',
  CRIPTO: 'Cripto',
  FCI: 'FCI',
  PLAZO_FIJO: 'Plazo fijo',
  BONO: 'Bono',
  OTRO: 'Otro',
};

const TYPE_FALLBACK_ICON: Record<InvestmentType, string> = {
  ACCION: '📈',
  ETF: '📊',
  CEDEAR: '🌎',
  CRIPTO: '🪙',
  FCI: '🧺',
  PLAZO_FIJO: '🏦',
  BONO: '📜',
  OTRO: '💼',
};

/** Cantidades con hasta 8 decimales (cripto fraccional). Porteado de InvestmentsPage.tsx (web). */
function formatQty(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 8 });
}

/** Monto en la moneda del activo; sin moneda usa el formato base de la app. */
function formatAsset(value: number, currency: string | null): string {
  if (!currency) return formatMoney(value);
  return `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${currency}`;
}

/** Precios unitarios: más decimales cuando el precio es chico (cripto, FCI). */
function formatPrice(value: number, currency: string | null): string {
  const digits = value > 0 && value < 1 ? 8 : 2;
  const num = value.toLocaleString('es-AR', { maximumFractionDigits: digits });
  return currency ? `${num} ${currency}` : `$ ${num}`;
}

/** TIR formateada con signo, o "—" si no hay dato (poco historial / no converge). */
function formatTir(tir: number | null | undefined): string {
  if (tir === null || tir === undefined) return '—';
  return `${tir >= 0 ? '+' : ''}${tir}%`;
}

function pnlColor(pnl: number, colors: ThemeColors): string {
  if (pnl > 0) return colors.deltaGood;
  if (pnl < 0) return colors.critical;
  return colors.textPrimary;
}

export function InvestmentsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [data, setData] = useState<InvestmentsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .listInvestments()
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rateMap = useMemo(() => new Map((data?.rates ?? []).map((r) => [r.currency, r.rate])), [data]);
  const activeItems = useMemo(
    () => (data?.items ?? []).filter((i) => !i.archivedAt).sort((a, b) => b.currentValue - a.currentValue),
    [data],
  );

  function renderAssetCard(inv: Investment) {
    const missingRate = inv.currency !== null && !rateMap.has(inv.currency);
    return (
      <Card key={inv.id} style={{ gap: 6 }}>
        <View style={styles.assetHead}>
          <View style={[styles.mark, { backgroundColor: `${inv.color}26`, borderColor: `${inv.color}4d` }]}>
            <Text style={{ fontSize: 16 }}>{inv.icon ?? inv.symbol?.slice(0, 3) ?? TYPE_FALLBACK_ICON[inv.type]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.assetName} numberOfLines={1}>
              {inv.name}
              {inv.symbol ? <Text style={styles.assetSymbol}>  {inv.symbol}</Text> : null}
            </Text>
            <Text style={styles.assetMeta}>
              {TYPE_LABELS[inv.type]}
              {inv.currency ? ` · ${inv.currency}` : ''}
              {inv.priceFactor === 100 ? ' · cada 100 VN' : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.assetValue}>{formatAsset(inv.currentValue, inv.currency)}</Text>
            <Text style={[styles.assetPnl, { color: pnlColor(inv.pnl, colors) }]}>
              {inv.pnl >= 0 ? '+' : ''}
              {formatAsset(inv.pnl, inv.currency)}
              {inv.investedCost > 0 ? ` (${inv.pnlPercent >= 0 ? '+' : ''}${inv.pnlPercent}%)` : ''}
            </Text>
          </View>
        </View>
        <MutedText>
          Tenencia {formatQty(inv.quantity)} · costo prom. {formatPrice(inv.avgCost, inv.currency)}
        </MutedText>
        {(inv.incomeCollected ?? 0) > 0 && (
          <Text style={{ color: colors.deltaGood, fontSize: 12.5 }}>
            Renta cobrada +{formatAsset(inv.incomeCollected ?? 0, inv.currency)}
          </Text>
        )}
        {missingRate && (
          <Text style={{ color: colors.warning, fontSize: 12 }}>
            Sin cotización {inv.currency} — no suma a los totales.
          </Text>
        )}
      </Card>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ErrorText>{error}</ErrorText>

        {data && data.summary.missingRates.length > 0 && (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>
              Falta cotización para: {data.summary.missingRates.join(', ')}. Cargala en "Cotizaciones" desde la web
              para incluir esos activos en los totales.
            </Text>
          </View>
        )}

        {data === null ? (
          <MutedText>Cargando…</MutedText>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryTile label="Valor total" value={formatMoney(data.summary.totalValue)} />
              <SummaryTile label="Invertido" value={formatMoney(data.summary.totalInvested)} />
              <SummaryTile
                label="Resultado"
                value={`${data.summary.pnl >= 0 ? '+' : ''}${formatMoney(data.summary.pnl)}`}
                tone={data.summary.pnl >= 0 ? 'good' : 'critical'}
                caption={
                  data.summary.totalInvested > 0
                    ? `${data.summary.pnlPercent >= 0 ? '+' : ''}${data.summary.pnlPercent}%${
                        data.summary.tir != null ? ` · TIR ${formatTir(data.summary.tir)}` : ''
                      }`
                    : undefined
                }
              />
            </View>

            {activeItems.length === 0 ? (
              <EmptyState text="No hay activos cargados. Agregalos desde la web." />
            ) : (
              <View style={{ gap: spacing.sm }}>{activeItems.map(renderAssetCard)}</View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { padding: spacing.md, paddingBottom: 32, gap: spacing.md },
    summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    warnBanner: {
      backgroundColor: 'rgba(242,185,90,0.13)',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    warnText: { color: colors.warning, fontSize: 12.5 },
    assetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    mark: {
      width: 36,
      height: 36,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assetName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    assetSymbol: { color: colors.textMuted, fontSize: 11 },
    assetMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    assetValue: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    assetPnl: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  });
}
```

Nota: `renderAssetCard` todavía no abre nada al tocar la tarjeta — eso lo agrega Task 4 junto con el detalle. Este paso ya es un deliverable completo y navegable por sí solo (resumen + lista funcionando).

- [ ] **Step 3: Wirear en `navItems.ts`**

En `apps/mobile/src/navItems.ts`, agregar `IcoTrend` al import (línea 1-15) y una entrada en `SECONDARY_ITEMS` (línea 36-43), antes de `Cuentas`:

```ts
import {
  IcoDebt,
  IcoDoc,
  IcoGrid,
  IcoList,
  IcoMeter,
  IcoRepeat,
  IcoSettings,
  IcoSpark,
  IcoTag,
  IcoTarget,
  IcoTrend,
  IcoWallet,
  type IconProps,
} from './components/icons';
```

```ts
export const SECONDARY_ITEMS: NavItem[] = [
  { route: 'Sugerencias', label: 'Sugerencias', icon: IcoSpark },
  { route: 'Inversiones', label: 'Inversiones', icon: IcoTrend },
  { route: 'Cuentas', label: 'Cuentas', icon: IcoWallet },
  { route: 'Deudas', label: 'Deudas', icon: IcoDebt },
  { route: 'Metas', label: 'Metas', icon: IcoTarget },
  { route: 'Categorias', label: 'Categorías', icon: IcoTag },
  { route: 'Reportes', label: 'Reportes', icon: IcoDoc },
];
```

- [ ] **Step 4: Wirear en `App.tsx`**

En `apps/mobile/App.tsx`, agregar el import (junto a los demás, orden alfabético, línea 29 aprox.):

```tsx
import { InvestmentsScreen } from './src/screens/InvestmentsScreen';
```

Y agregar la entrada al mapa `SCREENS` (línea 47-59):

```tsx
const SCREENS: Record<string, React.ComponentType<any>> = {
  Resumen: DashboardScreen,
  Movimientos: TransactionsScreen,
  Presupuestos: BudgetsScreen,
  Fijos: RecurringScreen,
  Sugerencias: SuggestionsScreen,
  Inversiones: InvestmentsScreen,
  Cuentas: AccountsScreen,
  Deudas: DebtsScreen,
  Metas: GoalsScreen,
  Categorias: CategoriesScreen,
  Reportes: ReportsScreen,
  Preferencias: SettingsScreen,
};
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @myfinance/mobile`
Expected: 0 errores.

- [ ] **Step 6: Smoke manual (Expo)**

- Entrar a "Inversiones" desde el menú lateral → carga resumen (Valor total/Invertido/Resultado) y lista de activos, consistente con lo que muestra la web para el mismo usuario.
- Usuario sin activos → `EmptyState` "No hay activos cargados...".
- Si el usuario tiene un activo en moneda sin cotización cargada → aparece el aviso de `missingRates` arriba de la lista.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/ui.tsx apps/mobile/src/screens/InvestmentsScreen.tsx apps/mobile/src/navItems.ts apps/mobile/App.tsx
git commit -m "feat(mobile): pantalla de Inversiones (resumen + lista, solo lectura)"
```

---

### Task 4: `InvestmentsScreen` — detalle de activo (historial de operaciones + gráfico de precio)

**Depends on:** Task 3 (mismo archivo).

**Files:**
- Modify: `apps/mobile/src/screens/InvestmentsScreen.tsx`

**Interfaces:**
- Consumes: `api.getInvestment(id): Promise<InvestmentDetail>`, `api.getInvestmentPriceHistory(id, range): Promise<InvestmentPricePoint[]>` (`packages/shared/src/api.ts:361,370`); tipos `InvestmentDetail`, `InvestmentPricePoint`, `PriceHistoryRange`, `InvestmentOperationType` de `@myfinance/shared`; `BottomSheet`, `Chip` de `../components/ui`; `formatDate` de `../theme`; helpers `formatQty`/`formatAsset`/`formatPrice`/`formatTir`/`pnlColor`/`TYPE_LABELS` ya definidos en el archivo (Task 3).
- Produces: nada nuevo exportado — `InvestmentsScreen` sigue siendo el único export del archivo.

- [ ] **Step 1: Ampliar imports**

En `apps/mobile/src/screens/InvestmentsScreen.tsx`, reemplazar el bloque de imports del principio del archivo por:

```tsx
import type {
  Investment,
  InvestmentDetail,
  InvestmentPricePoint,
  InvestmentsOverview,
  InvestmentType,
  PriceHistoryRange,
} from '@myfinance/shared';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { api } from '../api';
import { formatDate, formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import { BottomSheet, Card, Chip, EmptyState, ErrorText, MutedText, SummaryTile } from '../components/ui';
```

- [ ] **Step 2: Agregar constantes y helpers de rango de precio**

Después de `pnlColor` (helper ya existente de Task 3), agregar:

```tsx
const PRICE_RANGE_OPTIONS: { value: PriceHistoryRange; label: string }[] = [
  { value: '1w', label: '1S' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'Año' },
  { value: '1y', label: '1A' },
];

const PRICE_RANGE_DAYS: Record<Exclude<PriceHistoryRange, 'ytd'>, number> = {
  '1w': 7,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

/** Espeja priceHistoryCutoff (apps/api/src/lib/investments.ts), igual que la web. */
function priceRangeStart(range: PriceHistoryRange, now: Date): Date {
  if (range === 'ytd') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(now.getTime() - PRICE_RANGE_DAYS[range] * 86_400_000);
}

/** Mensaje según la causa real de no tener curva: nunca hubo historial, o lo hay pero no en este rango. */
function priceHistoryEmptyMessage(detail: InvestmentDetail): string {
  if (detail.priceHistory.length >= 2) {
    return 'No hay datos suficientes en este rango. Probá un rango más amplio.';
  }
  if (!detail.providerSymbol) {
    return 'Cargá el precio manualmente al menos dos veces desde la web para ver la evolución.';
  }
  if (detail.providerMarket === 'notes' || detail.providerMarket === 'corp') {
    return 'Este instrumento no tiene histórico en data912: el gráfico se va completando con la actualización diaria.';
  }
  return 'Todavía no pudimos obtener el histórico de precios. Se irá completando con la actualización diaria.';
}

/** Etiqueta contextual de la renta según el tipo de activo. */
function rentaLabel(type: InvestmentType): string {
  if (type === 'BONO') return 'Cupón';
  if (type === 'ACCION' || type === 'CEDEAR' || type === 'ETF') return 'Dividendo';
  return 'Renta';
}
```

- [ ] **Step 3: Estado de detalle + apertura desde la tarjeta**

Dentro de `InvestmentsScreen`, después de la declaración de `activeItems` (Task 3), agregar:

```tsx
  const [selected, setSelected] = useState<Investment | null>(null);
  const [detail, setDetail] = useState<InvestmentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  function onOpenDetail(inv: Investment) {
    setSelected(inv);
    setDetail(null);
    setDetailError(null);
    api
      .getInvestment(inv.id)
      .then(setDetail)
      .catch((err) => setDetailError(err instanceof Error ? err.message : 'Error inesperado'));
  }
```

- [ ] **Step 4: Hacer la tarjeta presionable**

Envolver el contenido de `renderAssetCard` (Task 3) en un `Pressable`. Reemplazar:

```tsx
    return (
      <Card key={inv.id} style={{ gap: 6 }}>
        <View style={styles.assetHead}>
```

por:

```tsx
    return (
      <Card key={inv.id} style={{ gap: 6 }}>
        <Pressable onPress={() => onOpenDetail(inv)}>
        <View style={styles.assetHead}>
```

Y cerrar el `Pressable` justo antes del cierre de `Card` (después del bloque `{missingRate && (...)}`, reemplazar):

```tsx
        {missingRate && (
          <Text style={{ color: colors.warning, fontSize: 12 }}>
            Sin cotización {inv.currency} — no suma a los totales.
          </Text>
        )}
      </Card>
    );
```

por:

```tsx
        {missingRate && (
          <Text style={{ color: colors.warning, fontSize: 12 }}>
            Sin cotización {inv.currency} — no suma a los totales.
          </Text>
        )}
        </Pressable>
      </Card>
    );
```

- [ ] **Step 5: Agregar el `BottomSheet` al final del `return`**

En `InvestmentsScreen`, justo antes del `</View>` de cierre del `return` (después de `</ScrollView>`), agregar:

```tsx
      <BottomSheet visible={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {detailError ? (
          <ErrorText>{detailError}</ErrorText>
        ) : detail === null ? (
          <MutedText>Cargando…</MutedText>
        ) : (
          <DetailContent detail={detail} />
        )}
      </BottomSheet>
```

- [ ] **Step 6: Componente `DetailContent`**

Al final del archivo, después de la función `createStyles`, agregar:

```tsx
function DetailContent({ detail }: { detail: InvestmentDetail }) {
  const { colors } = useTheme();
  const { width: winWidth } = useWindowDimensions();
  const [range, setRange] = useState<PriceHistoryRange>('1m');
  const [points, setPoints] = useState<InvestmentPricePoint[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setHistoryError(null);
    api
      .getInvestmentPriceHistory(detail.id, range)
      .then((data) => {
        if (!cancelled) setPoints(data);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : 'Error inesperado');
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, range]);

  const chartWidth = winWidth - spacing.lg * 2;
  const chartHeight = 110;

  const chart = useMemo(() => {
    if (!points || points.length < 2) return null;
    const now = new Date();
    const domainStart = priceRangeStart(range, now).getTime();
    const domainSpan = Math.max(now.getTime() - domainStart, 1);
    const padY = 12;
    const values = points.map((p) => p.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const valueRange = max - min || 1;
    const pts = points.map((p) => ({
      p,
      x: ((new Date(p.date).getTime() - domainStart) / domainSpan) * chartWidth,
      y: padY + (1 - (p.price - min) / valueRange) * (chartHeight - padY * 2),
    }));
    const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${chartHeight} L ${pts[0].x.toFixed(1)} ${chartHeight} Z`;
    return { pts, line, area, min, max };
  }, [points, range, chartWidth]);

  return (
    <View style={{ gap: spacing.sm + 2 }}>
      {detail.tir != null && (
        <View style={detailStyles.row}>
          <MutedText>TIR anualizada</MutedText>
          <Text style={{ color: pnlColor(detail.tir, colors), fontWeight: '600' }}>{formatTir(detail.tir)}</Text>
        </View>
      )}
      {(detail.incomeCollected ?? 0) > 0 && (
        <View style={detailStyles.row}>
          <MutedText>Renta cobrada</MutedText>
          <Text style={{ color: colors.deltaGood, fontWeight: '600' }}>
            +{formatAsset(detail.incomeCollected ?? 0, detail.currency)}
          </Text>
        </View>
      )}

      <View>
        <Text style={[detailStyles.sectionLabel, { color: colors.textSecondary }]}>Precio</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs, marginBottom: spacing.sm }}
        >
          {PRICE_RANGE_OPTIONS.map((opt) => (
            <Chip key={opt.value} label={opt.label} active={range === opt.value} onPress={() => setRange(opt.value)} />
          ))}
        </ScrollView>
        {historyError ? (
          <ErrorText>{historyError}</ErrorText>
        ) : points === null ? (
          <MutedText>Cargando…</MutedText>
        ) : chart === null ? (
          <MutedText>{priceHistoryEmptyMessage(detail)}</MutedText>
        ) : (
          <>
            <Svg width={chartWidth} height={chartHeight}>
              <Defs>
                <LinearGradient id="invPriceFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={0.25} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={chart.area} fill="url(#invPriceFill)" />
              <Path
                d={chart.line}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </Svg>
            <View style={detailStyles.chartFooter}>
              <MutedText>{formatDate(points[0].date)}</MutedText>
              <MutedText>
                mín {formatPrice(chart.min, detail.currency)} · máx {formatPrice(chart.max, detail.currency)}
              </MutedText>
              <MutedText>{formatDate(points[points.length - 1].date)}</MutedText>
            </View>
          </>
        )}
      </View>

      <View>
        <Text style={[detailStyles.sectionLabel, { color: colors.textSecondary }]}>Operaciones</Text>
        {detail.operations.length === 0 ? (
          <MutedText>Sin operaciones registradas.</MutedText>
        ) : (
          detail.operations.map((op) => {
            const isRenta = op.type === 'RENTA';
            const label = isRenta ? rentaLabel(detail.type) : op.type === 'COMPRA' ? 'Compra' : 'Venta';
            return (
              <View key={op.id} style={detailStyles.opRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 13 }}>
                    {label} ·{' '}
                    {isRenta ? 'Renta cobrada' : `${formatQty(op.quantity)} × ${formatPrice(op.unitPrice, detail.currency)}`}
                  </Text>
                  <MutedText>
                    {formatDate(op.date)}
                    {op.note ? ` · ${op.note}` : ''}
                  </MutedText>
                </View>
                <Text
                  style={{
                    color: isRenta ? colors.deltaGood : colors.textPrimary,
                    fontWeight: '600',
                    fontSize: 13,
                  }}
                >
                  {isRenta
                    ? `+${formatAsset(op.unitPrice, detail.currency)}`
                    : formatAsset((op.quantity * op.unitPrice) / detail.priceFactor, detail.currency)}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { fontWeight: '600', fontSize: 13, marginBottom: 6 },
  chartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  opRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
});
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @myfinance/mobile`
Expected: 0 errores.

- [ ] **Step 8: Smoke manual (Expo)**

- Tocar un activo de la lista → abre el `BottomSheet` con título = nombre del activo.
- TIR aparece si el activo tiene `tir != null` (requiere ≥2 flujos y ≥30 días de historial — spec 14).
- Cambiar entre chips de rango (1S/1M/3M/6M/Año/1A) → el gráfico se redibuja con los puntos de ese rango.
- Activo sin historial de precio suficiente → mensaje de `priceHistoryEmptyMessage` en vez de gráfico roto.
- Lista de operaciones consistente con la web para el mismo activo (compra/venta con cantidad×precio, renta con "Renta cobrada").
- Sin conexión → `ErrorText` con mensaje de error, sin crash.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/screens/InvestmentsScreen.tsx
git commit -m "feat(mobile): detalle de activo en Inversiones (historial + gráfico de precio)"
```

---

## Self-Review

**Cobertura de la spec 18 (contexto actualizado):**
- Registro (validación ≥8 + link recuperar contraseña): Task 2. ✅ (link cruzado login↔registro y alta de cuenta ya existían — no había nada más que hacer ahí).
- Inversiones fase 1 (resumen con TIR + lista con precio/tenencia/PnL + detalle con historial de operaciones y gráfico simple de precio + nav + `missingRates`): Tasks 1, 3, 4. ✅
- Sugerencias: ya implementada, sin tarea (documentado en la sección de contexto para que quien ejecute el plan no la reconstruya).
- Fuera de alcance (fase 2 de Inversiones, notificaciones push de precios): correctamente no incluido.

**Placeholders:** ninguno — todo paso de código trae el snippet completo, sin "TODO"/"similar a".

**Consistencia de tipos:** `pnlColor(pnl, colors)`, `formatTir`, `formatAsset`, `formatPrice`, `formatQty` se definen una sola vez en Task 3 y Task 4 los reutiliza sin redefinir (mismo archivo). `SummaryTile`'s nuevo prop `caption` es opcional, no rompe los usos existentes en `DebtsScreen.tsx`.
