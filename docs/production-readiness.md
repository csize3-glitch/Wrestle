# WrestleWell Production Readiness

## Mobile Builds

- EAS project: `d27873ba-78af-4020-8900-b701311cf9c3`
- iOS bundle id: `com.csize8.wrestlewell`
- Android package: `com.csize8.wrestlewell`

Recommended order:

1. Build development app:
   `cd /Users/csize8/Documents/wrestlewell/apps/mobile && ../../node_modules/.bin/eas build --profile development --platform ios`
2. Install development build on a real phone.
3. Test notification permissions and push-token registration outside Expo Go.
4. Build preview app:
   `cd /Users/csize8/Documents/wrestlewell/apps/mobile && ../../node_modules/.bin/eas build --profile preview --platform all`
5. Build production app after QA:
   `cd /Users/csize8/Documents/wrestlewell/apps/mobile && ../../node_modules/.bin/eas build --profile production --platform all`

## Web Deployment

Recommended host: Vercel.

Required production env vars:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Firebase console checklist:

- Add production web domain to Firebase Auth authorized domains.
- Deploy Firestore rules and indexes before launch.
- Confirm Firestore indexes are fully built.

## Final QA

- Coach sign up creates a team and team code.
- Athlete sign up joins by team code.
- Athlete can create and edit their own wrestler profile.
- Coach can create and edit roster profiles.
- Practice plans save, reopen, update, and run on mobile timer.
- Mobile timer supports seconds, voice, vibration, countdown, and video.
- Calendar assignments show on web and mobile.
- Tournament links open externally.
- Athlete taps `I Registered`.
- Coach sees registration notification.
- Coach verifies tournament registration.
- Coach sees tournament roster by event.
- Athlete cannot write coach-only data.
- Coach announcement appears in mobile notifications.

## Still Needed Before Store Launch

- Privacy policy URL.
- Support/contact email.
- App Store screenshots.
- Play Store screenshots.
- Production logo/icon review.
- Remote push sender service for OS-level coach alerts.
- App backup/export plan for Firestore.
- Error monitoring plan.

## Future Enhancements

- Remote push fanout when athletes tap `I Registered`.
- Remote push fanout for coach announcements.
- Tournament registration deadline field and reminders.
- Coach verification notes on tournament entries.
- Athlete-specific tournament checklist.
- Optional USA Bracketing integration only if a supported/allowed path becomes available.
