import { test, expect } from "@playwright/test";
import { db, closeDb } from "../../src/db";
import { sql, eq } from "drizzle-orm";
import { fixtures } from "../../src/db/schema";
import { seedSession } from "./session";
import { seedBrowserEditions } from "./setup";
import { seedAwardReview, awardWeeks } from "../fixtures/awards";
import { assertTestDatabase } from "../database";
test.describe("weekly awards review", () => {
  test.beforeEach(async () => {
    assertTestDatabase(process.env.TEST_DATABASE_URL);
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
  });
  test.afterEach(async () => {
    await db().execute(sql`TRUNCATE edition_state, users CASCADE`);
    await seedBrowserEditions();
  });
  test.afterAll(closeDb);
  test("Admin reviews published results; anonymous readers see only deliberate current awards", async ({
    page,
    context,
    browser,
    isMobile,
  }, info) => {
    const adminId = isMobile ? 70001 : 60001;
    await context.addCookies(
      [await seedSession(adminId), await seedSession(60101)].slice(0, 1),
    );
    const seeded = await seedAwardReview(adminId, 60101);
    await context.setExtraHTTPHeaders({ Origin: "http://127.0.0.1:3100" });
    const endpoint = "/api/admin/tournaments/test-cup/awards";
    expect(
      (
        await context.request.post(endpoint, {
          data: {
            action: "configure",
            policy: "relative-game-mean-v1",
            confirmed: true,
            expectedVersion: 0,
            weeks: awardWeeks,
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/admin/tournaments/test-cup/awards");
    await expect(
      page.getByRole("heading", { name: "Weekly awards", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /Tier:/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("table").last()).toContainText("6");
    const policy = page.getByRole("region", {
      name: "Award policy and calculation",
      exact: true,
    });
    await expect(policy.getByRole("listitem")).toHaveCount(3);
    await expect(policy.getByRole("listitem").nth(0)).toHaveText(
      "MVP: at least 6 appearances.",
    );
    await expect(policy.getByRole("listitem").nth(1)).toContainText("MIP:");
    await expect(policy.getByRole("listitem").nth(2)).toContainText("Rookie:");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Approve & publish", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved." }),
    ).toHaveText("Saved.");
    const anonymous = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
      storageState: {
        cookies: [
          {
            name: "oclr-locale",
            value: "en",
            domain: "127.0.0.1",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
    });
    try {
      await anonymous.route("https://a.ppy.sh/**", (route) => route.abort());
      const publicPage = await anonymous.newPage();
      await publicPage.goto("/tournaments/test-cup/results/awards");
      await expect(publicPage.locator(".award-winners")).toBeVisible();
      await expect(
        publicPage.locator(".award-winner .avatar span").first(),
      ).toBeVisible();
      expect((await anonymous.request.post(endpoint, { data: {} })).ok()).toBe(
        false,
      );
      const payload = await (
        await anonymous.request.get("/api/tournaments/test-cup/awards")
      ).json();
      expect(payload[0].stale).toBe(false);
      expect(JSON.stringify(payload)).not.toMatch(
        /answers|statusReason|identities|fingerprint/,
      );
      await publicPage.screenshot({
        path: info.outputPath("published-awards.png"),
        fullPage: true,
      });
      await db()
        .update(fixtures)
        .set({ scheduledAt: new Date("2026-10-09T12:00:00Z") })
        .where(eq(fixtures.id, seeded.fixtureId));
      await publicPage.reload();
      await expect(publicPage.getByRole("status")).toHaveText(
        "Source changed; review required.",
      );
      await expect(publicPage.locator(".award-winners")).toHaveCount(0);
    } finally {
      await anonymous.close();
    }
  });
});
