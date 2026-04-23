# WrestleWell Launch QA Checklist

Use this checklist against the live Firebase project after deploying Firestore rules and indexes.

## Setup

- Confirm web env vars point to the `wrestle-well-2` Firebase project.
- Confirm mobile env vars point to the same Firebase project.
- Start web with `pnpm dev:web`.
- Start mobile with `pnpm dev:mobile`.
- Keep Firebase Console open for Authentication and Firestore.

## Coach Account

- Create a new coach account on web.
- Confirm onboarding completes without errors.
- Confirm a team is created automatically.
- Confirm the coach dashboard/home shows the correct team name.
- Copy the generated team code for athlete testing.
- Sign out and sign back in as the same coach.

Expected result:
- Coach can sign in repeatedly.
- Coach user doc exists in `users`.
- Team doc exists in `teams`.
- Team member doc exists in `team_members`.

## Athlete Account

- Create a new athlete account on web using the coach team code.
- Confirm onboarding completes without errors.
- Sign out and sign back in as the athlete.

Expected result:
- Athlete is linked to the coach team.
- Athlete user doc has `currentTeamId`.
- Athlete team member doc exists.

## Web Coach Workflow

- Sign in as coach.
- Open `/wrestlers`.
- Create a wrestler profile.
- Update the wrestler profile.
- Save a mat-side summary for that wrestler.
- Delete the mat-side summary.
- Recreate the mat-side summary.

Expected result:
- Success messages show inline.
- Wrestler appears in roster immediately.
- Mat-side summary persists after refresh.

## Practice Plans

- Open `/practice-plans`.
- Create a plan with at least one library block.
- Add a text block.
- Save the plan.
- Reopen the saved plan.
- Update the title or block timing.
- Save again.
- Delete the plan.

Expected result:
- Saved plan appears in the left panel.
- Reopened plan matches saved blocks.
- Delete removes the plan and related blocks.

## Calendar

- Create a new practice plan first.
- Open `/calendar`.
- Assign the saved plan to a date.
- Open the calendar item back into `/practice-plans?open=<planId>`.

Expected result:
- Calendar event is created.
- Linked plan opens correctly.
- Team-scoped data only shows coach team items.

## Tournament Hub

- Open `/tournaments`.
- Verify imported tournaments appear.
- Create a manual tournament.
- Open the manual tournament.
- Add at least one wrestler to the tournament roster.
- Remove the wrestler from the tournament roster.
- Delete the manual tournament.
- Open an imported tournament registration link.

Expected result:
- Imported tournaments remain visible.
- Manual tournaments save under the coach team.
- Tournament roster entries save and delete cleanly.

## Mobile Sign-In

- Open the mobile app.
- Sign in as coach.
- Confirm the home screen loads team-aware content.
- Sign out.
- Sign in as athlete.

Expected result:
- Session persists correctly.
- No `auth/invalid-api-key` or `auth/configuration-not-found` errors appear.

## Mobile Coach Workflow

- Sign in as coach on mobile.
- Open `Wrestlers`.
- Confirm team roster loads.
- Open a wrestler detail.
- Jump to `Mat-Side`.
- Confirm summary data loads.
- Open `Tournaments`.
- Confirm tournament list loads for the signed-in team flow.

Expected result:
- Mobile reflects the same shared Firestore data as web.
- Navigation between wrestler and mat-side keeps the selected wrestler context.

## Security Checks

- Sign in as athlete on web.
- Attempt to create or edit a wrestler.
- Attempt to save a practice plan.
- Attempt to create or edit a tournament.

Expected result:
- Athlete should be blocked from coach-only writes.
- Team-scoped reads should still work where intended.

## Regression Checks

- Refresh each major page while signed in:
  - `/`
  - `/wrestlers`
  - `/practice-plans`
  - `/calendar`
  - `/tournaments`
- Confirm no console errors block rendering.
- Confirm mobile reload still restores session state.

## Ship Blockers

Do not treat the build as launch-ready if any of these fail:

- Coach onboarding fails.
- Athlete team join fails.
- Team-scoped data leaks across users.
- Coach-only writes are allowed for athletes.
- Practice plans fail to save or reopen.
- Mobile cannot read wrestler or mat-side data after sign-in.
- Tournament links or tournament entries fail consistently.
