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

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <h1>💰 MyFinance</h1>
        <p className="muted">
          {mode === 'login' ? 'Iniciá sesión para continuar' : 'Creá tu cuenta gratis'}
        </p>
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
        <button disabled={busy}>
          {busy ? 'Procesando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
        </button>
        <p className="muted">
          {mode === 'login' ? (
            <>
              ¿No tenés cuenta? <Link to="/registro">Registrate</Link>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
