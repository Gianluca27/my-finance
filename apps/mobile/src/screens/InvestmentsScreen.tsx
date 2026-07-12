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
