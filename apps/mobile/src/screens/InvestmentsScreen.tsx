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

  function renderAssetCard(inv: Investment) {
    const missingRate = inv.currency !== null && !rateMap.has(inv.currency);
    return (
      <Card key={inv.id} style={{ gap: 6 }}>
        <Pressable onPress={() => onOpenDetail(inv)} style={{ gap: 6 }}>
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
        </Pressable>
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

      <BottomSheet visible={selected !== null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {detailError ? (
          <ErrorText>{detailError}</ErrorText>
        ) : detail === null ? (
          <MutedText>Cargando…</MutedText>
        ) : (
          <DetailContent detail={detail} />
        )}
      </BottomSheet>
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
