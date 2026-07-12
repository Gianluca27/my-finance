import type { Account, DashboardData, ImportResult } from '@myfinance/shared';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, baseUrl, getToken } from '../api';
import { Card, ErrorText, Field, Input, MutedText, PrimaryButton, SectionTitle, Select } from '../components/ui';
import { currentMonth, formatMoney, monthName, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

export function ReportsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const [importing, setImporting] = useState(false);
  const [importAccountId, setImportAccountId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.dashboard().then(setDash).catch((err) => setError(err.message));
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    api
      .listAccounts()
      // Spec 19: se usa solo items del nuevo shape (paridad multi-moneda pendiente, spec 18).
      .then(({ items: accs }) => {
        setAccounts(accs);
        const def = accs.find((a) => a.isDefault) ?? accs[0];
        if (def) setImportAccountId(def.id);
      })
      .catch(() => {});
  }, []);

  async function downloadAndShare(kind: 'csv' | 'pdf', filename: string, params: Record<string, string>) {
    setError(null);
    setBusy(kind);
    try {
      const url = api.reportUrl(kind, params);
      const token = await getToken();
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      const res = await FileSystem.downloadAsync(url, dest, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri);
      } else {
        setError(`Archivo guardado en ${res.uri}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el reporte');
    } finally {
      setBusy(null);
    }
  }

  async function onImport() {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', '*/*'] });
      if (picked.canceled || !picked.assets?.[0]) return;
      setImporting(true);
      const csv = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const result = await api.importTransactions(csv, importAccountId ?? undefined);
      setImportResult(result);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar el CSV');
    } finally {
      setImporting(false);
    }
  }

  const monthLbl = dash ? monthName(dash.month) : '';
  const net = dash ? dash.monthIncome - dash.monthExpense : 0;
  const accOptions = accounts.map((a) => ({ label: a.name, value: a.id, icon: a.icon }));

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
      <ErrorText>{error}</ErrorText>

      {dash && (
        <Card>
          <SectionTitle>Resumen de {monthLbl}</SectionTitle>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.sLabel}>Ingresos</Text>
              <Text style={[styles.sValue, { color: colors.deltaGood }]}>{formatMoney(dash.monthIncome)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.sLabel}>Gastos</Text>
              <Text style={[styles.sValue, { color: colors.expense }]}>{formatMoney(dash.monthExpense)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.sLabel}>Neto</Text>
              <Text style={[styles.sValue, { color: net >= 0 ? colors.deltaGood : colors.critical }]}>
                {formatMoney(net)}
              </Text>
            </View>
          </View>
        </Card>
      )}

      <Card>
        <SectionTitle>Transacciones CSV</SectionTitle>
        <MutedText>Exportá tus movimientos en un rango de fechas.</MutedText>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Desde">
              <Input value={from} onChangeText={setFrom} placeholder="AAAA-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Hasta">
              <Input value={to} onChangeText={setTo} placeholder="AAAA-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label={busy === 'csv' ? 'Generando…' : 'Descargar CSV'}
            busy={busy === 'csv'}
            onPress={() => downloadAndShare('csv', 'transacciones.csv', { ...(from ? { from } : {}), ...(to ? { to } : {}) })}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>Resumen PDF</SectionTitle>
        <MutedText>Generá un PDF con el resumen de un mes.</MutedText>
        <View style={{ marginTop: spacing.sm }}>
          <Field label="Mes">
            <Input value={month} onChangeText={setMonth} placeholder="AAAA-MM" autoCapitalize="none" />
          </Field>
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label={busy === 'pdf' ? 'Generando…' : 'Generar PDF'}
            busy={busy === 'pdf'}
            onPress={() => downloadAndShare('pdf', `reporte-${month}.pdf`, { month })}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>Importar CSV</SectionTitle>
        <MutedText>
          Formato esperado: fecha,tipo,monto,categoria,nota. Las categorías se buscan por nombre; si no existe, el
          movimiento queda sin categoría.
        </MutedText>
        {accounts.length > 0 && (
          <View style={{ marginTop: spacing.sm }}>
            <Field label="Importar en la cuenta">
              <Select value={importAccountId} options={accOptions} onChange={setImportAccountId} placeholder="Cuenta" />
            </Field>
          </View>
        )}
        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton label={importing ? 'Importando…' : 'Elegir archivo CSV'} busy={importing} onPress={onImport} />
        </View>
        {importResult && (
          <View style={{ marginTop: spacing.sm, gap: 4 }}>
            <Text style={styles.resultText}>
              <Text style={{ fontWeight: '700' }}>{importResult.imported}</Text> movimientos importados
              {importResult.skipped > 0 ? ` · ${importResult.skipped} ignorados` : ''}
              {importResult.errors.length > 0 ? ` · ${importResult.errors.length} con errores` : ''}
            </Text>
            {importResult.errors.slice(0, 10).map((e, i) => (
              <Text key={i} style={{ color: colors.critical, fontSize: 12 }}>
                Línea {e.line}: {e.reason}
              </Text>
            ))}
          </View>
        )}
      </Card>

      {dash && <MutedText>Movimientos registrados en {monthLbl}.</MutedText>}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    summaryRow: { flexDirection: 'row', gap: spacing.md },
    summaryItem: { flex: 1 },
    sLabel: { color: colors.textMuted, fontSize: 12 },
    sValue: { fontWeight: '700', fontSize: 16, marginTop: 2 },
    resultText: { color: colors.textSecondary, fontSize: 13 },
  });
}
