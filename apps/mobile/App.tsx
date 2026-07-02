import { NavigationContainer } from '@react-navigation/native';
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
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();

const TAB_ICONS: Record<string, string> = {
  Dashboard: '📊',
  Transacciones: '💸',
  'Gastos fijos': '🔁',
  Presupuestos: '🎯',
};

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <TouchableOpacity onPress={logout} style={{ paddingHorizontal: 16 }}>
      <Text style={{ color: colors.accent, fontWeight: '600' }}>Salir</Text>
    </TouchableOpacity>
  );
}

function Root() {
  const { user, loading } = useAuth();

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

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerRight: () => <LogoutButton />,
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

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Root />
    </AuthProvider>
  );
}
