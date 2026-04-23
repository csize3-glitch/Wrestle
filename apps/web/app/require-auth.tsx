"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuthState } from "./auth-provider";

export function RequireAuth({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { firebaseUser, appUser, loading } = useAuthState();

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>{title}</h1>
        <p>Checking your account...</p>
      </main>
    );
  }

  if (!firebaseUser || !appUser) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>{title}</h1>
        <p style={{ marginBottom: 20 }}>{description}</p>
        <div className="content-card" style={{ maxWidth: 720 }}>
          <h2 className="content-card__title">Sign in required</h2>
          <p className="content-card__copy">
            This section is available once you sign in and finish your coach or athlete setup.
          </p>
          <div className="hero-actions" style={{ marginTop: 18 }}>
            <Link href="/" className="button-primary">
              Go to Sign In
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
