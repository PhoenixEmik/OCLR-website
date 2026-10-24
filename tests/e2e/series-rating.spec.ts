import { test, expect } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db";
import { seedSession } from "./session";
import { seedBrowserEditions } from "./setup";
import { seedAwardReview, awardWeeks } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
test.describe("round ratings and MRA awards", () => {
  test.beforeEach(async () => {
    assertTestDatabase(process.env.TEST_DATABASE_URL);
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedBrowserEditions();
  });
  test.afterEach(async () => {
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedBrowserEditions();
  });
  test.afterAll(closeDb);
  test("reaggregates a published round and publishes explicit MRA awards", async ({
    page,
    context,
    isMobile,
  }) => {
    const admin = isMobile ? 70001 : 60001;
    await context.addCookies([await seedSession(admin)]);
    await seedSession(193002);
    await seedAwardReview(admin, 193002, 193100);
    await page.goto("/tournaments/test-cup/results");
    const round = page.getByRole("region", {
      name: "Round YumuRating",
      exact: true,
    });
    await expect(round.getByRole("table")).toBeVisible();
    await expect(round).toContainText("1 of 1 published fixtures");
    await context.setExtraHTTPHeaders({ Origin: "http://127.0.0.1:3100" });
    expect(
      (
        await context.request.post("/api/admin/tournaments/test-cup/awards", {
          data: {
            action: "configure",
            confirmed: true,
            expectedVersion: 0,
            weeks: awardWeeks,
            policy: "yumu-mra-v1",
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/admin/tournaments/test-cup/awards");
    await expect(page.getByLabel("Rating policy")).toHaveValue("yumu-mra-v1");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Approve & publish", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved." }),
    ).toBeVisible();
    await page.goto("/tournaments/test-cup/results/awards");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table")).not.toContainText("%");
  });
});
