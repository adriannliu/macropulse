import { Amplify } from 'aws-amplify';
import {
  signInWithRedirect,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchUserAttributes,
  type AuthUser,
} from 'aws-amplify/auth';
import { useState, useEffect } from 'react';
import outputs from '../amplify_outputs.json';

export let isAmplifyConfigured = false;

if (outputs && Object.keys(outputs).length > 0) {
  try {
    Amplify.configure(outputs);
    isAmplifyConfigured = true;
  } catch (err) {
    console.warn('Amplify outputs not configured yet', err);
  }
}

export interface UserSession {
  user: AuthUser | null;
  email: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuthSession(): UserSession & {
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
} {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      if (!isAmplifyConfigured) {
        setIsLoading(false);
        return;
      }
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        const attrs = await fetchUserAttributes();
        setEmail(attrs.email || currentUser.username || null);
      } catch {
        setUser(null);
        setEmail(null);
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, []);

  const loginWithGoogle = async () => {
    if (!isAmplifyConfigured) {
      throw new Error('AWS Amplify backend is not deployed yet.');
    }
    try {
      await signInWithRedirect({ provider: 'Google' });
    } catch (err) {
      console.error('Google Sign-in failed', err);
      throw err;
    }
  };

  const logout = async () => {
    try {
      if (isAmplifyConfigured) {
        await amplifySignOut();
      }
      setUser(null);
      setEmail(null);
    } catch (err) {
      console.error('Sign out error', err);
    }
  };

  return {
    user,
    email,
    isLoading,
    isAuthenticated: !!user,
    loginWithGoogle,
    logout,
  };
}
