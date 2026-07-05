import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    // SDK 53+ reemplazó shouldShowAlert por banner/list.
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Pide permiso de notificaciones y registra el token FCM del dispositivo en el
 * backend. Requiere un development build (no funciona en Expo Go) y el
 * google-services.json del proyecto de Firebase.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Recordatorios de pagos',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const token = await Notifications.getDevicePushTokenAsync();
    if (token?.data) {
      await api.registerFcmToken(String(token.data), Platform.OS);
    }
  } catch (err) {
    // En Expo Go no hay token FCM nativo; se omite silenciosamente
    console.warn('No se pudo registrar el token de push:', err);
  }
}
