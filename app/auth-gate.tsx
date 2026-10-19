'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase/client';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // INITIAL_SESSION restores Supabase's persisted browser session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      setPassword('');
      setError('');
    });
    return () => subscription.unsubscribe();
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError(signInError.message);
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="auth-shell" role="status">Loading…</div>;
  if (session) return children;

  return <main className="auth-shell">
    <form className="login-card" onSubmit={signIn}>
      <h1>Home Energy</h1>
      <h2>Sign in</h2>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={pending}/>
      <label htmlFor="password">Password</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={pending}/>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="upload login-submit" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>;
}

export function SignOutControl() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setPending(true);
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) setError('Unable to sign out. Please try again.');
    } catch {
      setError('Unable to sign out. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <div className="sign-out-control">
    <button className="sign-out" type="button" onClick={signOut} disabled={pending}>{pending ? 'Signing out…' : 'Sign Out'}</button>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
