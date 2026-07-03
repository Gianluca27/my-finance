import { useState } from 'react';
import { api, setCachedUser } from '../api';
import { useAuth } from '../auth';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const [emailAlerts, setEmailAlerts] = useState(user?.emailAlerts ?? true);
  const [pushAlerts, setPushAlerts] = useState(user?.pushAlerts ?? false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: 'emailAlerts' | 'pushAlerts') {
    const next = key === 'emailAlerts' ? !emailAlerts : !pushAlerts;
    setError(null);
    if (key === 'emailAlerts') setEmailAlerts(next);
    else setPushAlerts(next);
    try {
      const updated = await api.updateAlertPreferences({ [key]: next });
      setCachedUser(updated);
    } catch (err) {
      if (key === 'emailAlerts') setEmailAlerts(!next);
      else setPushAlerts(!next);
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  const initials = (user?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="mf-eyebrow" style={{ marginBottom: 4 }}>
          Alertas
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Alertas por email</div>
            <div className="muted">
              Avisos de gastos fijos próximos a vencer y presupuestos excedidos.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emailAlerts}
            className={`mf-toggle ${emailAlerts ? 'on' : ''}`}
            onClick={() => toggle('emailAlerts')}
          >
            <span className="mf-toggle-knob" />
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Notificaciones push</div>
            <div className="muted">Recordatorios en el celular antes de cada vencimiento.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={pushAlerts}
            className={`mf-toggle ${pushAlerts ? 'on' : ''}`}
            onClick={() => toggle('pushAlerts')}
          >
            <span className="mf-toggle-knob" />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="mf-eyebrow" style={{ marginBottom: 4 }}>
          Cuenta
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="mf-avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div className="settings-row-title">{user?.name}</div>
            <div className="muted">{user?.email}</div>
          </div>
          <button className="secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </>
  );
}
