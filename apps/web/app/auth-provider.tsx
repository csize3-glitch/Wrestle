"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@wrestlewell/firebase/client";
import { getAppUser, getTeam, signOutAccount } from "@wrestlewell/lib/index";
import type { AppUser, Team } from "@wrestlewell/types/index";

type AuthContextValue = {
  firebaseUser: User | null;
  appUser: AppUser | null;
  currentTeam: Team | null;
  loading: boolean;
  refreshAppState: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);

  async function hydrateUserState(nextUser: User | null) {
    setFirebaseUser(nextUser);

    if (!nextUser) {
      setAppUser(null);
      setCurrentTeam(null);
      return;
    }

    const nextAppUser = await getAppUser(db, nextUser.uid);
    setAppUser(nextAppUser);

    if (nextAppUser?.currentTeamId) {
      setCurrentTeam(await getTeam(db, nextAppUser.currentTeamId));
    } else {
      setCurrentTeam(null);
    }
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      try {
        await hydrateUserState(nextUser);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      appUser,
      currentTeam,
      loading,
      refreshAppState: async () => {
        await hydrateUserState(auth.currentUser);
      },
      signOut: async () => {
        await signOutAccount(auth);
      },
    }),
    [appUser, currentTeam, firebaseUser, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthState must be used within AuthProvider");
  }

  return context;
}
