import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { IcoLogout, LogoMark, type IconProps } from './icons';
import { PRIMARY_ITEMS, SECONDARY_ITEMS, SETTINGS_ITEM, type NavItem } from '../navItems';
import { navigationRef } from '../navigationRef';
import { useSidebar } from '../SidebarContext';
import { fonts, radius, spacing, type ThemeColors } from '../theme';
import { useTheme } from '../ThemeContext';

const PANEL_WIDTH = Math.min(300, Math.round(Dimensions.get('window').width * 0.84));
const OPEN_MS = 220;
const CLOSE_MS = 170;

/**
 * Sidebar desplegable desde la barra superior (icono hamburguesa). Reemplaza a
 * la navbar inferior y a la página "Más". Overlay animado (Modal transparente +
 * Animated) que desliza desde la izquierda; el backdrop y el botón back cierran.
 */
export function Sidebar({ activeRoute }: { activeRoute: string | undefined }) {
  const { isOpen, close } = useSidebar();
  const { logout } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  // `mounted` mantiene el Modal montado durante la animación de cierre.
  const [mounted, setMounted] = useState(isOpen);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  function go(route: string) {
    close();
    if (route !== activeRoute && navigationRef.isReady()) {
      navigationRef.navigate(route as never);
    }
  }

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={close}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom, transform: [{ translateX }] },
          ]}
        >
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <LogoMark color={colors.onAccent} size={18} />
            </View>
            <View style={styles.brandTitles}>
              <Text style={styles.brandText}>MyFinance</Text>
              <Text style={styles.brandTag}>gestión privada</Text>
            </View>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingVertical: spacing.sm }}
            showsVerticalScrollIndicator={false}
          >
            {[...PRIMARY_ITEMS, ...SECONDARY_ITEMS].map((it) => (
              <Row key={it.route} item={it} active={it.route === activeRoute} onPress={go} styles={styles} colors={colors} />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Row
              item={SETTINGS_ITEM}
              active={SETTINGS_ITEM.route === activeRoute}
              onPress={go}
              styles={styles}
              colors={colors}
            />
            <TouchableOpacity style={styles.logout} onPress={logout}>
              <View style={styles.iconWrap}>
                <IcoLogout color={colors.critical} size={20} />
              </View>
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({
  item,
  active,
  onPress,
  styles,
  colors,
}: {
  item: NavItem;
  active: boolean;
  onPress: (route: string) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
}) {
  const Icon = item.icon as (p: IconProps) => React.ReactElement;
  const tint = active ? colors.accent : colors.textSecondary;
  return (
    <TouchableOpacity style={[styles.row, active && styles.rowActive]} onPress={() => onPress(item.route)}>
      <View style={styles.iconWrap}>
        <Icon color={tint} size={20} />
      </View>
      <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{item.label}</Text>
    </TouchableOpacity>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, flexDirection: 'row' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    panel: {
      width: PANEL_WIDTH,
      height: '100%',
      backgroundColor: colors.surface,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
      marginBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    brandMark: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.accent,
      shadowOpacity: 0.5,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    brandTitles: { flexDirection: 'column' },
    brandText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 17, lineHeight: 20 },
    brandTag: {
      color: colors.gold,
      fontFamily: fonts.serifItalic,
      fontSize: 11.5,
      lineHeight: 14,
    },
    list: { flex: 1, paddingHorizontal: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
    },
    rowActive: { backgroundColor: colors.chipActiveBg },
    iconWrap: { width: 24, alignItems: 'center', justifyContent: 'center' },
    rowLabel: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 15 },
    rowLabelActive: { color: colors.accent, fontFamily: fonts.semibold },
    footer: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    logout: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
    },
    logoutText: { color: colors.critical, fontFamily: fonts.medium, fontSize: 15 },
  });
}
