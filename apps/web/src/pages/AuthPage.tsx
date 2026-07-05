import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { LogoMark } from '../components/icons';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Bienvenido de nuevo' : 'Creá tu cuenta';
  const subtitle =
    mode === 'login' ? 'Ingresá para ver tu panel financiero.' : 'Empezá a organizar tus finanzas hoy.';
  const cta = mode === 'login' ? 'Ingresar' : 'Crear cuenta';

  return (
    <div className="mf-authgrid">
      <div className="mf-authhero">
        <div className="mf-authhero-glow" />
        <div className="mf-authhero-brand">
          <span className="mf-brand-mark">
            <LogoMark />
          </span>
          <span className="mf-brand-titles">
            <span className="mf-brand-name">MyFinance</span>
            <span className="mf-brand-tag">gestión privada</span>
          </span>
        </div>
        <div className="mf-authhero-copy">
          <h2>
            Tus finanzas, con <em>claridad y precisión</em>.
          </h2>
          <p>
            Balance, presupuestos, gastos fijos y deudas en un solo lugar. Sin ruido, sin banca
            conectada — solo control.
          </p>
          <div className="mf-authhero-stats">
            <div>
              <div className="mf-authhero-stat-value">7</div>
              <div className="mf-authhero-stat-label">módulos</div>
            </div>
            <div>
              <div className="mf-authhero-stat-value">CSV·PDF</div>
              <div className="mf-authhero-stat-label">exportables</div>
            </div>
            <div>
              <div className="mf-authhero-stat-value">2</div>
              <div className="mf-authhero-stat-label">alertas</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mf-authform-wrap">
        <form className="mf-authform" onSubmit={onSubmit}>
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {error && <div className="error-banner">{error}</div>}
          {mode === 'register' && (
            <label className="field">
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            </label>
          )}
          <label className="field">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          <button className="mf-auth-cta" disabled={busy}>
            {busy ? 'Procesando…' : cta}
          </button>
          <p className="mf-authform-switch">
            {mode === 'login' ? (
              <>
                ¿No tenés cuenta? <Link to="/registro">Registrate</Link>
              </>
            ) : (
              <>
                ¿Ya tenés cuenta? <Link to="/login">Ingresá</Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
