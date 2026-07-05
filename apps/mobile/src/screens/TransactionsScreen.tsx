import type { Account, Category, Transaction, TransactionType } from '@myfinance/shared';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { api, baseUrl, getToken } from '../api';
import { AddTransactionModal } from '../components/AddTransactionModal';
import {
  Chip,
  Dot,
  ErrorText,
  FAB,
  IconButton,
  Input,
  MutedText,
  Select,
} from '../components/ui';
import { formatMoney, formatShortDate, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

const PAGE_SIZE = 20;
const TYPE_TABS: { label: string; value: '' | TransactionType }[] = [
  { label: 'Todos', value: '' },
  { label: 'Ingresos', value: 'INCOME' },
  { label: 'Gastos', value: 'EXPENSE' },
];

export function TransactionsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'' | TransactionType>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; uri: string } | null>(null);
  const [viewBusy, setViewBusy] = useState(false);

  const load = useCallback(() => {
    const filters: Record<string, unknown> = { page, pageSize: PAGE_SIZE };
    if (filterType) filters.type = filterType;
    if (filterCategory) filters.categoryId = filterCategory;
    if (filterAccount) filters.accountId = filterAccount;
    if (search) filters.search = search;
    return api
      .listTransactions(filters)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [page, filterType, filterCategory, filterAccount, search]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
    api.listAccounts().then(setAccounts).catch(() => {});
  }, []);

  // Debounce de búsqueda.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  async function onPickReceipt(tx: Transaction) {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Necesitás dar permiso a la galería para adjuntar recibos.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setUploadingId(tx.id);
      const targetWidth = asset.width && asset.width > 1280 ? 1280 : asset.width || 1280;
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: targetWidth } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (manipulated.base64) {
        await api.uploadReceipt(tx.id, manipulated.base64, 'image/jpeg');
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo adjuntar el recibo');
    } finally {
      setUploadingId(null);
    }
  }

  async function onViewReceipt(tx: Transaction) {
    setViewBusy(true);
    try {
      const token = await getToken();
      const dest = `${FileSystem.cacheDirectory}receipt-${tx.id}.jpg`;
      const res = await FileSystem.downloadAsync(
        `${baseUrl}/api/transactions/${tx.id}/receipt`,
        dest,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setViewing({ id: tx.id, uri: res.uri });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el recibo');
    } finally {
      setViewBusy(false);
    }
  }

  function onDeleteReceipt(id: string) {
    Alert.alert('Eliminar recibo', '¿Eliminar el recibo adjunto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () =>
          api
            .deleteReceipt(id)
            .then(() => {
              setViewing(null);
              load();
            })
            .catch((err) => setError(err.message)),
      },
    ]);
  }

  function onDelete(tx: Transaction) {
    Alert.alert('Eliminar', '¿Eliminar este movimiento?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => api.deleteTransaction(tx.id).then(load).catch((err) => setError(err.message)),
      },
    ]);
  }

  const catOptions = [
    { label: 'Todas las categorías', value: '' },
    ...categories.map((c) => ({ label: c.name, value: c.id, color: c.color, icon: c.icon })),
  ];
  const accOptions = [
    { label: 'Todas las cuentas', value: '' },
    ...accounts.map((a) => ({ label: a.name, value: a.id, icon: a.icon })),
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TYPE_TABS.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                active={filterType === t.value}
                onPress={() => {
                  setFilterType(t.value);
                  setPage(1);
                }}
              />
            ))}
          </View>
        </ScrollView>
        <Input
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Buscar por nota o monto…"
          autoCapitalize="none"
        />
        <Select
          value={filterCategory}
          options={catOptions}
          onChange={(v) => {
            setFilterCategory(v);
            setPage(1);
          }}
          placeholder="Todas las categorías"
        />
        {accounts.length > 0 && (
          <Select
            value={filterAccount}
            options={accOptions}
            onChange={(v) => {
              setFilterAccount(v);
              setPage(1);
            }}
            placeholder="Todas las cuentas"
          />
        )}
        <MutedText>{total} movimientos</MutedText>
      </View>

      {error && <ErrorText>{error}</ErrorText>}

      <FlatList
        data={items}
        keyExtractor={(tx) => tx.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        ListEmptyComponent={<Text style={styles.muted}>Sin movimientos.</Text>}
        renderItem={({ item: tx }) => (
          <View style={styles.row}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Dot color={tx.category?.color ?? colors.neutralDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{tx.category?.name ?? 'Sin categoría'}</Text>
                <Text style={styles.rowSub}>
                  {formatShortDate(tx.date)}
                  {tx.note ? ` · ${tx.note}` : ''}
                  {accounts.length > 1 ? ` · ${accountName(tx.accountId)}` : ''}
                </Text>
              </View>
            </View>
            <Text
              style={[
                styles.rowAmount,
                { color: tx.type === 'INCOME' ? colors.deltaGood : colors.textPrimary },
              ]}
            >
              {tx.type === 'INCOME' ? '+' : '−'}
              {formatMoney(tx.amount)}
            </Text>
            <View style={styles.rowActions}>
              <IconButton
                icon="📎"
                color={tx.receiptMime ? colors.accent : colors.textMuted}
                disabled={uploadingId === tx.id || viewBusy}
                onPress={() => (tx.receiptMime ? onViewReceipt(tx) : onPickReceipt(tx))}
              />
              <IconButton icon="✎" onPress={() => setEditing(tx)} />
              <IconButton icon="🗑" color={colors.critical} onPress={() => onDelete(tx)} />
            </View>
          </View>
        )}
        ListFooterComponent={
          total > PAGE_SIZE ? (
            <View style={styles.pager}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                style={[styles.pagerBtn, page <= 1 && { opacity: 0.4 }]}
              >
                <Text style={styles.pagerText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.muted}>
                Página {page} de {totalPages}
              </Text>
              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={[styles.pagerBtn, page >= totalPages && { opacity: 0.4 }]}
              >
                <Text style={styles.pagerText}>→</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />

      <FAB onPress={() => setShowAdd(true)} />

      <AddTransactionModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={load}
      />
      <AddTransactionModal
        visible={!!editing}
        transaction={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />

      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewerWrap}>
          {viewing && (
            <Image source={{ uri: viewing.uri }} style={styles.viewerImage} resizeMode="contain" />
          )}
          <View style={styles.viewerActions}>
            <TouchableOpacity onPress={() => viewing && onDeleteReceipt(viewing.id)}>
              <Text style={{ color: colors.critical, fontWeight: '600' }}>Eliminar recibo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setViewing(null)}>
              <Text style={{ color: colors.onAccent, fontWeight: '600' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: colors.page },
    filters: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm + 2,
      marginBottom: spacing.sm,
    },
    rowTitle: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    rowSub: { color: colors.textMuted, fontSize: 12 },
    rowAmount: { fontWeight: '700', fontSize: 14, marginHorizontal: 4 },
    rowActions: { flexDirection: 'row', alignItems: 'center' },
    pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.md },
    pagerBtn: {
      borderWidth: 1,
      borderColor: colors.gridline,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    pagerText: { color: colors.textPrimary, fontSize: 16 },
    viewerWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
    viewerImage: { width: '92%', height: '75%' },
    viewerActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
  });
}
