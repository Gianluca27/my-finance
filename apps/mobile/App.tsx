import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  useFonts,
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { registerForPushNotifications } from './src/notifications';
import { AccountsScreen } from './src/screens/AccountsScreen';
import { BudgetsScreen } from './src/screens/BudgetsScreen';
import { CategoriesScreen } from './src/screens/CategoriesScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { DebtsScreen } from './src/screens/DebtsScreen';
import { GoalsScreen } from './src/screens/GoalsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MoreMenuScreen } from './src/screens/MoreMenuScreen';
import { RecurringScreen } from './src/screens/RecurringScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import {
  IcoGrid,
  IcoList,
  IcoLogout,
  IcoMenu,
  IcoMeter,
  IcoRepeat,
  type IconProps,
} from './src/components/icons';
import { fonts } from './src/theme';
import { ThemeProvider, useTheme } from './src/ThemeContext';

const Tab = createBottomTabNavigator();
const MoreStack = createNativeStackNavigator();

const TAB_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  Resumen: IcoGrid,
  Movimientos: IcoList,
  Presupuestos: IcoMeter,
  Fijos: IcoRepeat,
  Más: IcoMenu,
};

// Aplica Schibsted Grotesk como fuente por defecto de todo <Text>. Una sola vez.
let defaultFontApplied = false;
function applyDefaultFont() {
  if (defaultFontApplied) return;
  defaultFontApplied = true;
  const TextAny = Text as unknown as { defaultProps?: { style?: unknown } };
  TextAny.defaultProps = TextAny.defaultProps ?? {};
  TextAny.defaultProps.style = [{ fontFamily: fonts.regular }, TextAny.defaultProps.style];
}

function LogoutButton() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={logout} style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
      <IcoLogout color={colors.textSecondary} size={20} />
    </TouchableOpacity>
  );
}

function MoreNavigator() {
  const { colors } = useTheme();
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.bold },
        headerRight: () => <LogoutButton />,
      }}
    >
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'Más' }} />
      <MoreStack.Screen name="Cuentas" component={AccountsScreen} options={{ title: 'Cuentas' }} />
      <MoreStack.Screen name="Deudas" component={DebtsScreen} options={{ title: 'Deudas' }} />
      <MoreStack.Screen name="Metas" component={GoalsScreen} options={{ title: 'Metas' }} />
      <MoreStack.Screen name="Categorias" component={CategoriesScreen} options={{ title: 'Categorías' }} />
      <MoreStack.Screen name="Reportes" component={ReportsScreen} options={{ title: 'Reportes' }} />
      <MoreStack.Screen name="Preferencias" component={SettingsScreen} options={{ title: 'Preferencias' }} />
    </MoreStack.Navigator>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const [fontsLoaded] = useFonts({
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    if (user) registerForPushNotifications();
  }, [user]);

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.page }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  applyDefaultFont();

  if (!user) return <LoginScreen />;

  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: colors.page,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
      primary: colors.accent,
      notification: colors.critical,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerRight: () => <LogoutButton />,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.bold },
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
          tabBarIcon: ({ color }) => {
            const Icon = TAB_ICONS[route.name];
            return Icon ? <Icon color={color} size={22} /> : null;
          },
        })}
      >
        <Tab.Screen name="Resumen" component={DashboardScreen} />
        <Tab.Screen name="Movimientos" component={TransactionsScreen} />
        <Tab.Screen name="Presupuestos" component={BudgetsScreen} />
        <Tab.Screen name="Fijos" component={RecurringScreen} />
        <Tab.Screen name="Más" component={MoreNavigator} options={{ headerShown: false }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function ThemedRoot() {
  return (
    <>
      <StatusBar style="light" />
      <Root />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ThemedRoot />
      </AuthProvider>
    </ThemeProvider>
  );
}
