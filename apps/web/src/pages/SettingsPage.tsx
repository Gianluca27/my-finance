import type { DigestFrequency } from '@myfinance/shared';
import { useState, type FormEvent } from 'react';
import { api, setCachedUser } from '../api';
import { useAuth } from '../auth';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const [emailAlerts, setEmailAlerts] = useState(user?.emailAlerts ?? true);
  const [pushAlerts, setPushAlerts] = useState(user?.pushAlerts ?? false);
  const [digestFrequency, setDigestFrequency] = useState<DigestFrequency>(
    user?.digestFrequency ?? 'MONTHLY',
  );
  const [baseCurrency, setBaseCurrency] = useState(user?.baseCurrency ?? 'ARS');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  async function changeDigest(next: DigestFrequency) {
    const prev = digestFrequency;
    setError(null);
    setDigestFrequency(next);
    try {
      const updated = await api.updateAlertPreferences({ digestFrequency: next });
      setCachedUser(updated);
    } catch (err) {
      setDigestFrequency(prev);
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

  async function changeBaseCurrency(next: string) {
    const prev = baseCurrency;
    setError(null);
    setBaseCurrency(next);
    try {
      const updated = await api.updateAlertPreferences({ baseCurrency: next });
      setCachedUser(updated);
    } catch (err) {
      setBaseCurrency(prev);
      setError(err instanceof Error ? err.message : 'Error inesperado');
    }
  }

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

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.name) return;
    setNameError(null);
    setNameBusy(true);
    try {
      const updated = await api.updateAlertPreferences({ name: trimmed });
      setCachedUser(updated);
      setName(updated.name);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setNameBusy(false);
    }
  }

  const initials = (user?.name ?? '?').slice(0, 1).toUpperCase();
  const nameChanged = name.trim() !== '' && name.trim() !== user?.name;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="mf-label" style={{ marginBottom: 4 }}>
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
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Resumen periódico</div>
            <div className="muted">
              Email con tus ingresos, gastos y categorías del período. Independiente de las alertas.
            </div>
          </div>
          <select
            value={digestFrequency}
            onChange={(e) => changeDigest(e.target.value as DigestFrequency)}
            aria-label="Frecuencia del resumen periódico"
          >
            <option value="NONE">Ninguno</option>
            <option value="WEEKLY">Semanal</option>
            <option value="MONTHLY">Mensual</option>
            <option value="BOTH">Semanal y mensual</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="mf-label" style={{ marginBottom: 4 }}>
          Preferencias
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-title">Moneda base</div>
            <div className="muted">
              Los totales consolidados (dashboard, patrimonio neto) se muestran en esta moneda; las
              cuentas en otra moneda se convierten con la cotización vigente. Ojo: los montos de
              presupuestos y gastos fijos no se convierten al cambiarla — pasan a interpretarse en
              la nueva moneda base.
            </div>
          </div>
          <select
            value={baseCurrency}
            onChange={(e) => changeBaseCurrency(e.target.value)}
            aria-label="Moneda base"
          >
            {!['ARS', 'USD'].includes(baseCurrency) && (
              <option value={baseCurrency}>{baseCurrency}</option>
            )}
            <option value="ARS">ARS · Peso argentino</option>
            <option value="USD">USD · Dólar</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="mf-label" style={{ marginBottom: 4 }}>
          Cuenta
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="mf-avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <form onSubmit={saveName} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                aria-label="Nombre"
              />
              {nameChanged && (
                <button type="submit" className="secondary" disabled={nameBusy}>
                  {nameBusy ? 'Guardando…' : 'Guardar'}
                </button>
              )}
            </form>
            {nameError && (
              <div className="error-banner" style={{ marginTop: 8, marginBottom: 0 }}>
                {nameError}
              </div>
            )}
            <div className="muted">{user?.email}</div>
          </div>
          <button className="secondary" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>

      <ChangePasswordCard />
    </>
  );
}

/** Sección "Seguridad": cambio de contraseña con sesión activa. */
function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas nuevas no coinciden');
      return;
    }
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword, newPassword });
      setSuccess(res.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="mf-label" style={{ marginBottom: 4 }}>
        Seguridad
      </div>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 360 }}>
        {error && <div className="error-banner">{error}</div>}
        {success && <div className="success-banner">{success}</div>}
        <label className="field">
          Contraseña actual
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          Nueva contraseña
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          Confirmar nueva contraseña
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <button disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </form>
    </div>
  );
}
