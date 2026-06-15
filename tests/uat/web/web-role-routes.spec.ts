import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/calendar",
  "/follow-ups",
  "/library",
  "/notifications",
  "/practice-plans",
  "/settings",
  "/team",
  "/tournaments",
  "/vark-questionnaire",
  "/wrestlers",
];

for (const route of routes) {
  test(`web UAT: route ${route} renders without app errors`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error");
    await expect(page.locator("body")).not.toContainText("Missing or insufficient permissions");
  });
}
