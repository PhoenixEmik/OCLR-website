import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sql } from "drizzle-orm";
import { db, closeDb } from "../../src/db";
import { seedSession } from "./session";
import { seedBrowserEditions } from "./setup";
import { seedAwardReview } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
test.describe("scoped player evaluation", () => {
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
  test("localizes classifications in all appearances/themes and keeps evaluation details accessible", async ({
    page,
    context,
    isMobile,
  }, info) => {
    test.setTimeout(120_000);
    const admin = isMobile ? 70001 : 60001;
    await seedSession(admin);
    await seedSession(194002);
    const s = await seedAwardReview(admin, 194002, 194100);
    for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
      for (const theme of ["light", "dark"]) {
        for (const appearance of ["default", "cute-pastel", "swiss-minimal"]) {
          await context.addCookies([
            {
              name: "oclr-locale",
              value: locale,
              url: "http://127.0.0.1:3100",
            },
            { name: "oclr-theme", value: theme, url: "http://127.0.0.1:3100" },
            {
              name: "oclr-appearance",
              value: appearance,
              url: "http://127.0.0.1:3100",
            },
          ]);
          await page.goto(`/tournaments/test-cup/matches/${s.fixtureId}`);
          const table = page.getByRole("table").first();
          await expect(table.getByRole("row")).toHaveCount(5);
          const badge = table.locator("summary").first();
          await expect(badge).toBeVisible();
          await badge.click();
          await expect(table).toContainText("yumu-player-class-v2-oclr-v1");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          if (locale === "en") {
            await page.screenshot({
              path: info.outputPath(`player-class-${theme}-${appearance}.png`),
              fullPage: true,
            });
            const results = await new AxeBuilder({ page })
              .include("table")
              .analyze();
            expect(results.violations).toEqual([]);
          }
        }
      }
    }
    await context.addCookies([
      { name: "oclr-locale", value: "en", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto(`/players/${s.home.memberId}?edition=test-cup`);
    await expect(
      page.getByRole("region", { name: "Round YumuRating", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table").first().getByRole("row")).toHaveCount(
      2,
    );
  });
});
