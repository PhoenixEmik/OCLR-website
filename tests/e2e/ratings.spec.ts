import { test, expect } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db";
import { seedSession } from "./session";
import { seedBrowserEditions } from "./setup";
import { seedAwardReview } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
test.describe("YumuRating publication", () => {
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
  test("shows approved single-fixture ratings in public and Admin views", async ({
    page,
    context,
    isMobile,
  }) => {
    const adminId = isMobile ? 70001 : 60001;
    await context.addCookies([await seedSession(adminId)]);
    await seedSession(192002);
    const s = await seedAwardReview(adminId, 192002, 192100);
    await page.goto(`/tournaments/test-cup/matches/${s.fixtureId}`);
    const ratings = page.getByRole("region", {
      name: "YumuRating",
      exact: true,
    });
    await expect(ratings.getByRole("table")).toBeVisible();
    await expect(ratings.getByRole("row")).toHaveCount(5);
    await expect(ratings).toContainText("No star weighting is applied.");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto(`/admin/tournaments/test-cup/matches/${s.fixtureId}`);
    await expect(
      page
        .getByRole("region", { name: "YumuRating", exact: true })
        .getByRole("table"),
    ).toBeVisible();
  });
});
