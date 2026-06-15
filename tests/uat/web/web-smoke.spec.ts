import { test, expect } from "@playwright/test";

test("web UAT: homepage renders WrestleWell shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error");
  await expect(page.locator("body")).not.toContainText("Unhandled Runtime Error");
  await expect(page.locator("body")).not.toContainText("Missing or insufficient permissions");
  await expect(page.getByText("WrestleWell", { exact: false }).first()).toBeVisible();
});
