import { ApiError } from '@myfinance/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';

/** Marca/hero compartido entre las vistas de autenticación (login, registro, olvido, reset). */
function AuthHero() {
  return (
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
  );
}

/** Shell para vistas de auth sin campos (mensajes de error/éxito con solo un botón de acción). */
function AuthFormShell({ children }: { children: ReactNode }) {
  return (
    <div className="mf-authgrid">
      <AuthHero />
      <div className="mf-authform-wrap">
        <div className="mf-authform-sys" aria-hidden="true">
          SYS ONLINE · CIFRADO
        </div>
        <div className="mf-authform">{children}</div>
      </div>
    </div>
  );
}

/** Marca compacta que se muestra sobre el formulario en mobile (el panel hero se oculta). */
function AuthFormBrand() {
  return (
    <div className="mf-authform-brand">
      <span className="mf-brand-mark" aria-hidden="true">
        $
      </span>
      <span className="mf-brand-titles">
        <span className="mf-brand-name">MyFinance</span>
        <span className="mf-brand-tag">gestión // privada</span>
      </span>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

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

  if (mode === 'login' && showForgot) {
    return (
      <div className="mf-authgrid">
        <AuthHero />
        <div className="mf-authform-wrap">
          <div className="mf-authform-sys" aria-hidden="true">
            SYS ONLINE · CIFRADO
          </div>
          <ForgotPasswordForm onBack={() => setShowForgot(false)} />
        </div>
      </div>
    );
  }

  const title = mode === 'login' ? 'Bienvenido de nuevo' : 'Creá tu cuenta';
  const subtitle =
    mode === 'login' ? 'Ingresá para ver tu panel financiero.' : 'Empezá a organizar tus finanzas hoy.';
  const cta = mode === 'login' ? 'Ingresar' : 'Crear cuenta';

  return (
    <div className="mf-authgrid">
      <AuthHero />
      <div className="mf-authform-wrap">
        <div className="mf-authform-sys" aria-hidden="true">
          SYS ONLINE · CIFRADO
        </div>
        <form className="mf-authform" onSubmit={onSubmit}>
          {/* En mobile el panel de marca se oculta: la marca vuelve sobre el formulario. */}
          <AuthFormBrand />
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
          {mode === 'login' && (
            <button type="button" className="mf-authform-link" onClick={() => setShowForgot(true)}>
              ¿Olvidaste tu contraseña?
            </button>
          )}
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

/** Form de "olvidé mi contraseña": pide el email y siempre muestra el mismo mensaje de éxito. */
function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mf-authform" onSubmit={onSubmit}>
      <AuthFormBrand />
      <h1>Recuperar contraseña</h1>
      <p className="muted">Ingresá tu email y te mandamos un link para restablecerla.</p>
      {error && <div className="error-banner">{error}</div>}
      {sent ? (
        <div className="success-banner">
          Si el email existe en MyFinance, vas a recibir un link para restablecer tu contraseña.
        </div>
      ) : (
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
      )}
      {!sent && (
        <button className="mf-auth-cta" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar link'}
        </button>
      )}
      <button type="button" className="mf-authform-link" onClick={onBack}>
        Volver a inicio de sesión
      </button>
    </form>
  );
}

/** Vista de `/reset?token=...`: llegada desde el link del email, pide la nueva contraseña. */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword({ token, newPassword });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthFormShell>
        <AuthFormBrand />
        <h1>Link inválido</h1>
        <div className="error-banner">
          Falta el token de recuperación. Pedí un nuevo link desde{' '}
          <Link to="/login">inicio de sesión</Link>.
        </div>
      </AuthFormShell>
    );
  }

  if (done) {
    return (
      <AuthFormShell>
        <AuthFormBrand />
        <h1>Contraseña actualizada</h1>
        <div className="success-banner">Ya podés iniciar sesión con tu nueva contraseña.</div>
        <button className="mf-auth-cta" type="button" onClick={() => navigate('/login')}>
          Ir a inicio de sesión
        </button>
      </AuthFormShell>
    );
  }

  return (
    <div className="mf-authgrid">
      <AuthHero />
      <div className="mf-authform-wrap">
        <div className="mf-authform-sys" aria-hidden="true">
          SYS ONLINE · CIFRADO
        </div>
        <form className="mf-authform" onSubmit={onSubmit}>
          <AuthFormBrand />
          <h1>Elegí tu nueva contraseña</h1>
          <p className="muted">El link vence 1 hora después de haberlo pedido.</p>
          {error && <div className="error-banner">{error}</div>}
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
          <button className="mf-auth-cta" disabled={busy}>
            {busy ? 'Guardando…' : 'Restablecer contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
