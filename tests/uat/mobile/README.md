# WrestleWell Mobile UAT

Add Maestro flow templates here for role-based smoke coverage.

Suggested committed flows:
- `coach-smoke.template.yaml`
- `athlete-smoke.template.yaml`
- `parent-smoke.template.yaml`

The committed templates use placeholder tokens such as `__UAT_PARENT_EMAIL__`.
`scripts/run-uat-mobile.sh` resolves them into ignored local files under `.uat-mobile-resolved/`.

Do not commit real passwords or local personal accounts.
