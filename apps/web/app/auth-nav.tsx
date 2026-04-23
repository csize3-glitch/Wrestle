"use client";

import Link from "next/link";
import { useAuthState } from "./auth-provider";

export function AuthNav() {
  const { appUser, currentTeam, firebaseUser, loading, signOut } = useAuthState();

  if (loading) {
    return <div className="site-auth-pill">Checking session...</div>;
  }

  if (!firebaseUser) {
    return (
      <Link href="/" className="site-auth-pill site-auth-pill--ghost">
        Sign In
      </Link>
    );
  }

  return (
    <div className="site-auth-group">
      <div className="site-auth-pill">
        <strong>{appUser?.displayName || firebaseUser.email || "Signed in"}</strong>
        <span>{currentTeam?.name || (appUser ? appUser.role : "Finish setup")}</span>
      </div>

      <button className="site-auth-pill site-auth-pill--ghost" onClick={() => signOut()}>
        Sign Out
      </button>
    </div>
  );
}
