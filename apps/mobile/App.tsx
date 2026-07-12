import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  useFonts,
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
} from '@expo-google-fonts/schibsted-grotesk';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import {
  Newsreader_400Regular,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium_Italic,
} from '@expo-google-fonts/newsreader';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth';
import { registerForPushNotifications } from './src/notifications';
import { AccountsScreen } from './src/screens/AccountsScreen';
import { BudgetsScreen } from './src/screens/BudgetsScreen';
import { CategoriesScreen } from './src/screens/CategoriesScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { DebtsScreen } from './src/screens/DebtsScreen';
import { GoalsScreen } from './src/screens/GoalsScreen';
import { InvestmentsScreen } from './src/screens/InvestmentsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { RecurringScreen } from './src/screens/RecurringScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SuggestionsScreen } from './src/screens/SuggestionsScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { Sidebar } from './src/components/Sidebar';
import { IcoMenu } from './src/components/icons';
import { ALL_ITEMS } from './src/navItems';
import { navigationRef } from './src/navigationRef';
import { SidebarProvider, useSidebar } from './src/SidebarContext';
import { fonts } from './src/theme';
import { ThemeProvider, useTheme } from './src/ThemeContext';

const Stack = createNativeStackNavigator();

/** Cada `route` de navItems mapea a su pantalla. */
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

// Aplica Schibsted Grotesk como fuente por defecto de todo <Text>. Una sola vez.
let defaultFontApplied = false;
function applyDefaultFont() {
  if (defaultFontApplied) return;
  defaultFontApplied = true;
  const TextAny = Text as unknown as { defaultProps?: { style?: unknown } };
  TextAny.defaultProps = TextAny.defaultProps ?? {};
  TextAny.defaultProps.style = [{ fontFamily: fonts.regular }, TextAny.defaultProps.style];
}

/** Botón hamburguesa del header que abre la sidebar. */
function MenuButton() {
  const { open } = useSidebar();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={open} style={{ paddingHorizontal: 16, paddingVertical: 4 }} hitSlop={8}>
      <IcoMenu color={colors.textPrimary} size={22} />
    </TouchableOpacity>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [activeRoute, setActiveRoute] = useState<string | undefined>(ALL_ITEMS[0].route);
  const [fontsLoaded] = useFonts({
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    Newsreader_400Regular,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium_Italic,
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

  const syncRoute = () => setActiveRoute(navigationRef.getCurrentRoute()?.name);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} onReady={syncRoute} onStateChange={syncRoute}>
      <Stack.Navigator
        screenOptions={{
          headerLeft: () => <MenuButton />,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.bold },
          // Respeta la barra de gestos/navegación de Android (inset inferior).
          contentStyle: { paddingBottom: insets.bottom },
        }}
      >
        {ALL_ITEMS.map((it) => (
          <Stack.Screen key={it.route} name={it.route} component={SCREENS[it.route]} options={{ title: it.label }} />
        ))}
      </Stack.Navigator>
      <Sidebar activeRoute={activeRoute} />
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
        <SafeAreaProvider>
          <SidebarProvider>
            <ThemedRoot />
          </SidebarProvider>
        </SafeAreaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
