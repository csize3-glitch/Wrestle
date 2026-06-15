import { test } from "@playwright/test";

test.describe("web UAT: authenticated role smoke", () => {
  test.skip(
    true,
    "TODO: enable authenticated web role E2E after homepage auth initialization is stable under headless Playwright."
  );
});
