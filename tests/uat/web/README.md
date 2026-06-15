# WrestleWell Web UAT

Add Playwright UAT specs here for investor/demo checks.

Suggested coverage:
- coach team page loads
- parent linking section loads
- main coach routes render without permission errors
- weekly review and follow-up dashboard open cleanly

These specs are intentionally not credentialed. Use environment variables or local ignored fixtures for real login data.

Current note:
- authenticated web role E2E is still a TODO because the homepage auth/session initialization is not yet stable enough under headless Playwright to be considered trustworthy UAT coverage.
