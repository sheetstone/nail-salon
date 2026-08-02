'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { firebaseAuth, firebaseDb } from '@/lib/firebase-client';

interface AuthState {
  user: User | null;
  /** True until the first onAuthStateChanged callback lands. */
  loading: boolean;
  /** Display name from customers/{uid}, or null if the profile is incomplete. */
  profileName: string | null;
  /** Fresh ID token for Server Action calls. Throws if signed out. */
  getIdToken: () => Promise<string>;
  refreshProfile: () => Promise<void>;
  signOutNow: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState<string | null>(null);

  const loadProfile = useCallback(async (current: User | null) => {
    if (!current) {
      setProfileName(null);
      return;
    }
    try {
      const snap = await getDoc(doc(firebaseDb(), 'customers', current.uid));
      const name = snap.exists() ? (snap.data().name as string | undefined) : undefined;
      setProfileName(name && name.trim() ? name : null);
    } catch {
      // A missing profile is a normal first-sign-in state, not an error.
      setProfileName(null);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth(), async (next) => {
      setUser(next);
      await loadProfile(next);
      setLoading(false);
    });
    return unsubscribe;
  }, [loadProfile]);

  const getIdToken = useCallback(async () => {
    const current = firebaseAuth().currentUser;
    if (!current) throw new Error('Not signed in.');
    return current.getIdToken();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      profileName,
      getIdToken,
      refreshProfile: () => loadProfile(firebaseAuth().currentUser),
      signOutNow: () => signOut(firebaseAuth()),
    }),
    [user, loading, profileName, getIdToken, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
