import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

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
        <span className="mf-authhero-bracket tl" />
        <span className="mf-authhero-bracket tr" />
        <span className="mf-authhero-bracket br" />
        <div className="mf-authhero-brand">
          <span className="mf-brand-mark" aria-hidden="true">
            $
          </span>
          <span className="mf-brand-titles">
            <span className="mf-brand-name">MyFinance</span>
            <span className="mf-brand-tag">gestión // privada</span>
          </span>
        </div>
        <div className="mf-authhero-copy">
          <div className="mf-authhero-eyebrow">Panel financiero</div>
          <h2>Tus finanzas, con claridad y precisión.</h2>
          <p>
            Balance, presupuestos, gastos fijos y deudas en un solo lugar. Sin ruido, sin banca
            conectada — solo control.
          </p>
        </div>
        <div className="mf-authhero-stats">
          <div>
            <div className="mf-statfig">7</div>
            <div className="mf-statcap">módulos</div>
          </div>
          <div>
            <div className="mf-statfig">CSV·PDF</div>
            <div className="mf-statcap">exportables</div>
          </div>
          <div>
            <div className="mf-statfig">2</div>
            <div className="mf-statcap">alertas</div>
          </div>
        </div>
      </div>

      <div className="mf-authform-wrap">
        <div className="mf-authform-sys" aria-hidden="true">
          SYS ONLINE · CIFRADO
        </div>
        <form className="mf-authform" onSubmit={onSubmit}>
          {/* En mobile el panel de marca se oculta: la marca vuelve sobre el formulario. */}
          <div className="mf-authform-brand">
            <span className="mf-brand-mark" aria-hidden="true">
              $
            </span>
            <span className="mf-brand-titles">
              <span className="mf-brand-name">MyFinance</span>
              <span className="mf-brand-tag">gestión // privada</span>
            </span>
          </div>
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
          <div className="mf-authform-note">Sin banca conectada · Solo control</div>
        </form>
      </div>
    </div>
  );
}
