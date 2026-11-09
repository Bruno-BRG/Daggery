import { useState, type FormEvent } from 'react';
import { api } from './api';

type User = { id: string; username: string };
const input = 'daggery-auth-input';

export function AuthPanel({ onLogin, initialError }: { onLogin(user: User): Promise<void>; initialError: string }) {
  const [mode, setMode] = useState<'email' | 'password' | 'register'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [info, setInfo] = useState('');
  function changeMode(next: typeof mode) { setMode(next); setError(''); setInfo(''); setSent(false); setCode(''); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'email' && !sent) {
        await api('/api/email/request', 'POST', { email });
        setSent(true); setInfo('If the address can be used, we will send a code valid for 10 minutes.');
      } else if (mode === 'email') {
        try {
          const result = await api<{ user: User }>('/api/email/verify', 'POST', { email, code });
          setCode(''); await onLogin(result.user);
        } catch { setError('Invalid or expired code. Check and try again.'); }
      } else {
        if (mode === 'register') await api('/api/register', 'POST', { username, password });
        const result = await api<{ user: User }>('/api/login', 'POST', { username, password });
        setPassword(''); await onLogin(result.user);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="daggery-auth-shell">
    <div className="daggery-auth-wrap">
      <div className="daggery-logo daggery-auth-logo"><span className="daggery-logo-mark">✦</span> daggery</div>
      <section className="daggery-auth-card">
        <h1>{mode === 'register' ? 'Create account' : 'Sign in to your table'}</h1>
        <p>Your campaigns and notes in one place.</p>
        <form onSubmit={submit} className="daggery-auth-form">
          {mode === 'email' ? <>
            <label>Email<input className={input} type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setSent(false); setCode(''); setInfo(''); }} maxLength={254} required /></label>
            {sent && <label>8-digit code<input className={input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></label>}
          </> : <>
            <label>Username<input className={input} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={40} /></label>
            <label>Password<input className={input} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 12 : undefined} /></label>
            {mode === 'register' && <small>Use at least 12 characters.</small>}
          </>}
          {info && <p role="status" className="daggery-auth-message">{info}</p>}
          {error && <p role="alert" className="daggery-auth-error">{error}</p>}
          <button className="daggery-primary daggery-auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'email' ? sent ? 'Sign in with code' : 'Send code' : mode === 'register' ? 'Create account and sign in' : 'Sign in with password'}</button>
          {mode === 'email' && sent && <button className="daggery-auth-link" disabled={busy} type="button" onClick={() => { setSent(false); setCode(''); setInfo('You can request another code after a minute.'); }}>Request another code</button>}
        </form>
        <div className="daggery-auth-alternatives">
          {mode !== 'email' && <button type="button" onClick={() => changeMode('email')}>Sign in with email</button>}
          {mode !== 'password' && <button type="button" onClick={() => changeMode('password')}>Sign in with password</button>}
          {mode !== 'register' && <button type="button" onClick={() => changeMode('register')}>Create account with password</button>}
        </div>
      </section>
    </div>
  </main>;
}

export function LinkEmail() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      if (!sent) {
        await api('/api/email/link/request', 'POST', { email });
        setSent(true); setMessage('If the address can be linked, we will send a code.');
      } else {
        await api('/api/email/link/verify', 'POST', { email, code });
        setSent(false); setCode(''); setOpen(false); setMessage('Email linked. You can now use it to sign in.');
      }
    } catch (e) { setMessage(sent ? 'Invalid or expired code, or address unavailable.' : e instanceof Error ? e.message : 'Could not link email.'); }
    finally { setBusy(false); }
  }
  return <section className="daggery-email-link">
    <button className="daggery-roll-toggle" type="button" onClick={() => { setOpen(!open); setMessage(''); }}>Link email to account</button>
    {open && <form onSubmit={submit} className="daggery-email-link-form">
      <label>Email<input className={input} type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setSent(false); setCode(''); }} maxLength={254} required /></label>
      {sent && <label>8-digit code<input className={input} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></label>}
      <button className="daggery-primary" disabled={busy} type="submit">{busy ? 'Please wait…' : sent ? 'Confirm email' : 'Send code'}</button>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
