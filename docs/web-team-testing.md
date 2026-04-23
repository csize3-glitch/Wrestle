# Web Team Testing Setup

Use Vercel for the fastest public web preview.

## Deploy With Vercel

1. Go to https://vercel.com/new
2. Import the WrestleWell repo.
3. Keep the repo root as the project root.
4. Vercel should use:
   - Build command: `pnpm build:web`
   - Install command: `pnpm install --frozen-lockfile`
   - Output directory: `apps/web/.next`
5. Add these environment variables in Vercel:
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
6. Deploy.

## Firebase Auth

After Vercel gives you a URL:

1. Open Firebase Console.
2. Go to Authentication.
3. Open Settings.
4. Add the Vercel domain to Authorized domains.

Examples:

- `wrestlewell.vercel.app`
- any custom domain you add later

## Team Testing Flow

1. Coach creates an account.
2. Coach creates the team.
3. Coach shares the team code.
4. Wrestler creates an athlete account with the team code.
5. Athlete creates their wrestler profile.
6. Athlete opens tournaments and taps `I Registered`.
7. Coach opens notifications and verifies the tournament registration.

## Before Sharing Publicly

- Confirm Firestore rules are deployed.
- Confirm Email/Password auth is enabled.
- Confirm the Vercel URL is in Firebase authorized domains.
- Test coach signup once.
- Test athlete signup once.
- Test tournament registration once.
