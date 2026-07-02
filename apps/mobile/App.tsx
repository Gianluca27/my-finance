import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { registerForPushNotifications } from './src/notifications';
import { BudgetsScreen } from './src/screens/BudgetsScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { RecurringScreen } from './src/screens/RecurringScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { ThemeProvider, useTheme, type ThemePreference } from './src/ThemeContext';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Dashboard: '📊',
  Transacciones: '💸',
  'Gastos fijos': '🔁',
  Presupuestos: '🎯',
};

const PREFERENCE_ICON: Record<ThemePreference, string> = {
  system: '🖥️',
  light: '☀️',
  dark: '🌙',
};

function LogoutButton() {
  const { logout } = useAuth();
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={logout} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: colors.accent, fontWeight: '600' }}>Salir</Text>
    </TouchableOpacity>
  );
}

function ThemeToggleButton() {
  const { preference, cyclePreference } = useTheme();
  return (
    <TouchableOpacity onPress={cyclePreference} style={{ paddingHorizontal: 8 }}>
      <Text style={{ fontSize: 18 }}>{PREFERENCE_ICON[preference]}</Text>
    </TouchableOpacity>
  );
}

function Root() {
  const { user, loading } = useAuth();
  const { colors, scheme } = useTheme();

  useEffect(() => {
    if (user) registerForPushNotifications();
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.page }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!user) return <LoginScreen />;

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
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
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ThemeToggleButton />
              <LogoutButton />
            </View>
          ),
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarIcon: () => <Text>{TAB_ICONS[route.name] ?? '•'}</Text>,
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="Transacciones" component={TransactionsScreen} />
        <Tab.Screen name="Gastos fijos" component={RecurringScreen} />
        <Tab.Screen name="Presupuestos" component={BudgetsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function ThemedRoot() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
