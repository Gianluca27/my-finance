import type { Account, AccountType, Transfer } from '@myfinance/shared';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import { COLOR_PALETTE, fonts, formatDate, formatMoney, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';
import {
  BottomSheet,
  Card,
  ColorSwatchRow,
  Dot,
  EmptyState,
  ErrorText,
  FAB,
  Field,
  IconButton,
  Input,
  MutedText,
  type Option,
  OutlineButton,
  PrimaryButton,
  SectionTitle,
  Segmented,
  Select,
} from '../components/ui';

const TYPE_LABEL: Record<AccountType, string> = {
  CASH: 'Efectivo',
  BANK: 'Banco',
  CARD: 'Tarjeta',
  OTHER: 'Otra',
};
const TYPE_ICON: Record<AccountType, string> = { CASH: '💵', BANK: '🏦', CARD: '💳', OTHER: '👛' };

const TYPE_OPTIONS: Option[] = [
  { label: 'Efectivo', value: 'CASH', icon: TYPE_ICON.CASH },
  { label: 'Banco', value: 'BANK', icon: TYPE_ICON.BANK },
  { label: 'Tarjeta', value: 'CARD', icon: TYPE_ICON.CARD },
  { label: 'Otra', value: 'OTHER', icon: TYPE_ICON.OTHER },
];

const DEFAULT_OPTIONS: Option[] = [
  { label: 'Sí', value: 'yes' },
  { label: 'No', value: 'no' },
];

export function AccountsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Alta/edición de cuenta
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('BANK');
  const [initialBalance, setInitialBalance] = useState('0');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [icon, setIcon] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  // Transferencia
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      api.listAccounts().then(setAccounts),
      api.listTransfers().then(setTransfers),
    ]).catch((err) => setError(err instanceof Error ? err.message : 'Error inesperado'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const netWorth = accounts.reduce((sum, a) => sum + a.balance, 0);

  function openCreate() {
    setEditingId(null);
    setName('');
    setType('BANK');
    setInitialBalance('0');
    setColor(COLOR_PALETTE[0]);
    setIcon('');
    setIsDefault(false);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(a: Account) {
    setEditingId(a.id);
    setName(a.name);
    setType(a.type);
    setInitialBalance(String(a.initialBalance));
    setColor(a.color);
    setIcon(a.icon ?? '');
    setIsDefault(a.isDefault);
    setError(null);
    setFormOpen(true);
  }

  async function onSubmit() {
    if (!name.trim()) {
      setError('Ingresá un nombre.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        type,
        initialBalance: Number(initialBalance) || 0,
        color,
        icon: icon || null,
        isDefault,
      };
      if (editingId) await api.updateAccount(editingId, payload);
      else await api.createAccount(payload);
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  async function onSetDefault(a: Account) {
    setError(null);
    try {
      await api.updateAccount(a.id, { isDefault: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  function onDelete(a: Account) {
    Alert.alert('Eliminar cuenta', `¿Eliminar la cuenta "${a.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          try {
            await api.deleteAccount(a.id);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Error inesperado');
          }
        },
      },
    ]);
  }

  function openTransfer() {
    if (accounts.length < 2) {
      setError('Necesitás al menos dos cuentas para transferir.');
      return;
    }
    const def = accounts.find((a) => a.isDefault) ?? accounts[0];
    const other = accounts.find((a) => a.id !== def.id)!;
    setFromId(def.id);
    setToId(other.id);
    setTransferAmount('');
    setTransferNote('');
    setError(null);
    setTransferOpen(true);
  }

  async function onSubmitTransfer() {
    if (fromId === toId) {
      setError('Elegí cuentas distintas.');
      return;
    }
    const amount = Number(transferAmount);
    if (!(amount > 0)) {
      setError('Ingresá un monto mayor a cero.');
      return;
    }
    setError(null);
    setTransferBusy(true);
    try {
      await api.createTransfer({
        fromAccountId: fromId,
        toAccountId: toId,
        amount,
        note: transferNote || null,
      });
      setTransferOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setTransferBusy(false);
    }
  }

  function onDeleteTransfer(id: string) {
    Alert.alert(
      'Eliminar transferencia',
      '¿Eliminar transferencia? Los saldos de las cuentas se recalculan.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            try {
              await api.deleteTransfer(id);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Error inesperado');
            }
          },
        },
      ],
    );
  }

  const transferOptions: Option[] = accounts.map((a) => ({
    label: `${a.name} (${formatMoney(a.balance)})`,
    value: a.id,
    color: a.color,
    icon: a.icon ?? TYPE_ICON[a.type],
  }));

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* Patrimonio neto */}
        <Card>
          <Text style={styles.eyebrow}>Patrimonio neto</Text>
          <Text
            style={[styles.netWorth, { color: netWorth < 0 ? colors.critical : colors.textPrimary }]}
          >
            {formatMoney(netWorth)}
          </Text>
          <MutedText>Suma del saldo de todas tus cuentas</MutedText>
        </Card>

        {/* Acciones */}
        <View style={styles.actionsRow}>
          <OutlineButton label="Transferir entre cuentas" onPress={openTransfer} />
        </View>

        {/* Listado de cuentas */}
        {accounts.length === 0 ? (
          <EmptyState text="Todavía no tenés cuentas." />
        ) : (
          accounts.map((a) => (
            <Card key={a.id} style={styles.accountCard}>
              <View style={styles.cardHead}>
                <View style={[styles.iconCircle, { backgroundColor: a.color + '26' }]}>
                  <Text style={styles.iconText}>{a.icon ?? TYPE_ICON[a.type]}</Text>
                </View>
                <View style={styles.headTitles}>
                  <Text style={styles.accountName} numberOfLines={1}>
                    {a.name}
                    {a.isDefault ? <Text style={styles.mutedInline}> · predeterminada</Text> : null}
                  </Text>
                  <Text style={styles.typeLabel}>{TYPE_LABEL[a.type]}</Text>
                </View>
                <IconButton icon="✎" onPress={() => openEdit(a)} />
                <IconButton icon="🗑" onPress={() => onDelete(a)} color={colors.critical} />
              </View>

              <Text
                style={[
                  styles.balance,
                  { color: a.balance < 0 ? colors.critical : colors.textPrimary },
                ]}
              >
                {formatMoney(a.balance)}
              </Text>

              <View style={styles.cardFoot}>
                <MutedText>Saldo inicial {formatMoney(a.initialBalance)}</MutedText>
                {!a.isDefault ? (
                  <OutlineButton label="Predeterminar" onPress={() => onSetDefault(a)} />
                ) : null}
              </View>
            </Card>
          ))
        )}

        {/* Transferencias recientes */}
        {transfers.length > 0 ? (
          <Card style={styles.transfersCard}>
            <SectionTitle>Transferencias recientes</SectionTitle>
            {transfers.slice(0, 10).map((t) => (
              <View key={t.id} style={styles.transferRow}>
                <View style={styles.transferInfo}>
                  <View style={styles.transferLine}>
                    <Dot color={t.fromAccount.color} />
                    <Text style={styles.transferName} numberOfLines={1}>
                      {t.fromAccount.name}
                    </Text>
                    <Text style={styles.arrow}>→</Text>
                    <Dot color={t.toAccount.color} />
                    <Text style={styles.transferName} numberOfLines={1}>
                      {t.toAccount.name}
                    </Text>
                  </View>
                  {t.note ? <MutedText>{t.note}</MutedText> : null}
                  <MutedText>{formatDate(t.date)}</MutedText>
                </View>
                <Text style={styles.transferAmount}>{formatMoney(t.amount)}</Text>
                <IconButton
                  icon="🗑"
                  onPress={() => onDeleteTransfer(t.id)}
                  color={colors.critical}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <FAB onPress={openCreate} />

      {/* Alta / edición de cuenta */}
      <BottomSheet
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Editar cuenta' : 'Nueva cuenta'}
      >
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Field label="Nombre">
          <Input value={name} onChangeText={setName} maxLength={60} placeholder="Ej. Cuenta sueldo" />
        </Field>
        <Field label="Tipo">
          <Select
            value={type}
            options={TYPE_OPTIONS}
            onChange={(v) => setType(v as AccountType)}
            placeholder="Tipo de cuenta"
          />
        </Field>
        <Field label="Saldo inicial">
          <Input
            value={initialBalance}
            onChangeText={setInitialBalance}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </Field>
        <Field label="Emoji (opcional)">
          <Input value={icon} onChangeText={setIcon} maxLength={4} placeholder={TYPE_ICON[type]} />
        </Field>
        <Field label="Color">
          <ColorSwatchRow value={color} onChange={setColor} palette={COLOR_PALETTE} />
        </Field>
        <Field label="Usar como predeterminada">
          <Segmented
            options={DEFAULT_OPTIONS}
            value={isDefault ? 'yes' : 'no'}
            onChange={(v) => setIsDefault(v === 'yes')}
          />
        </Field>
        <PrimaryButton
          label={editingId ? 'Guardar' : 'Crear cuenta'}
          onPress={onSubmit}
          busy={busy}
        />
      </BottomSheet>

      {/* Transferir entre cuentas */}
      <BottomSheet visible={transferOpen} onClose={() => setTransferOpen(false)} title="Transferir">
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Field label="Desde">
          <Select
            value={fromId}
            options={transferOptions}
            onChange={setFromId}
            placeholder="Cuenta de origen"
          />
        </Field>
        <Field label="Hacia">
          <Select
            value={toId}
            options={transferOptions}
            onChange={setToId}
            placeholder="Cuenta de destino"
          />
        </Field>
        <Field label="Monto">
          <Input
            value={transferAmount}
            onChangeText={setTransferAmount}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </Field>
        <Field label="Nota (opcional)">
          <Input value={transferNote} onChangeText={setTransferNote} maxLength={500} />
        </Field>
        <PrimaryButton label="Transferir" onPress={onSubmitTransfer} busy={transferBusy} />
      </BottomSheet>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.page },
    content: { padding: spacing.md, gap: spacing.md, paddingBottom: 96 },
    eyebrow: {
      fontSize: 17,
      fontFamily: fonts.serifMediumItalic,
      color: colors.textSecondary,
    },
    netWorth: {
      fontSize: 32,
      fontFamily: fonts.serifMedium,
      marginVertical: 4,
      fontVariant: ['tabular-nums'],
    },
    actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    accountCard: { gap: spacing.sm },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    iconText: { fontSize: 20 },
    headTitles: { flex: 1, minWidth: 0 },
    accountName: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    mutedInline: { color: colors.textMuted, fontWeight: '400' },
    typeLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    balance: { fontSize: 26, fontWeight: '700' },
    cardFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    transfersCard: { gap: spacing.sm },
    transferRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    transferInfo: { flex: 1, minWidth: 0, gap: 2 },
    transferLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    transferName: { color: colors.textPrimary, fontSize: 14, maxWidth: 110 },
    arrow: { color: colors.textMuted, fontSize: 13 },
    transferAmount: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  });
}
