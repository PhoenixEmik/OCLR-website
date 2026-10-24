import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertTestDatabase } from "../database";
import { closeDb } from "../../src/db";
import { importLegacyEditions } from "../../scripts/import-editions";
import { edition } from "../fixtures/edition";
import bootstrap from "../../drizzle/legacy-editions.json" with { type: "json" };
const base = process.env.TEST_DATABASE_URL;
afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});
async function isolated(
  run: (pool: Pool, connection: string) => Promise<void>,
) {
  assertTestDatabase(base);
  const name = `oclr_migration_${randomUUID().replaceAll("-", "")}_test`;
  const admin = new Pool({ connectionString: base });
  const url = new URL(base);
  url.pathname = `/${name}`;
  let pool: Pool | undefined;
  try {
    await admin.query(
      `CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`,
    );
    pool = new Pool({ connectionString: url.toString() });
    await run(pool, url.toString());
  } finally {
    await closeDb();
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
}
describe.skipIf(!base)("Swiss appearance constraint upgrade", () => {
  it("preserves existing defaults and audit history while accepting the new design", async () =>
    isolated(async (pool) => {
      const folder = mkdtempSync(join(tmpdir(), "oclr-swiss-migration-test-"));
      try {
        cpSync("drizzle", folder, { recursive: true });
        const file = join(folder, "meta/_journal.json");
        const journal = JSON.parse(readFileSync(file, "utf8"));
        journal.entries = journal.entries.filter(
          (entry: { idx: number }) => entry.idx < 27,
        );
        writeFileSync(file, JSON.stringify(journal));
        await migrate(drizzle(pool), { migrationsFolder: folder });
        await pool.query(
          "UPDATE site_settings SET default_appearance='cute-pastel', revision=1 WHERE id=1",
        );
        const history = (
          await pool.query(
            "INSERT INTO site_setting_events (before_appearance,after_appearance,revision) VALUES ('default','cute-pastel',1) RETURNING *",
          )
        ).rows[0];
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query(
              "SELECT default_appearance,revision FROM site_settings",
            )
          ).rows,
        ).toEqual([{ default_appearance: "cute-pastel", revision: 1 }]);
        expect(
          (await pool.query("SELECT * FROM site_setting_events")).rows,
        ).toEqual([history]);
        await pool.query(
          "UPDATE site_settings SET default_appearance='swiss-minimal', revision=2 WHERE id=1",
        );
        await pool.query(
          "INSERT INTO site_setting_events (before_appearance,after_appearance,revision) VALUES ('cute-pastel','swiss-minimal',2)",
        );
        await expect(
          pool.query(
            "UPDATE site_settings SET default_appearance='unknown' WHERE id=1",
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(
            "INSERT INTO site_setting_events (before_appearance,after_appearance,revision) VALUES ('swiss-minimal','unknown',3)",
          ),
        ).rejects.toThrow();
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query(
              "SELECT default_appearance,revision FROM site_settings",
            )
          ).rows,
        ).toEqual([{ default_appearance: "swiss-minimal", revision: 2 }]);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM site_setting_events",
            )
          ).rows[0].count,
        ).toBe(2);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }));
});
describe.skipIf(!base)(
  "edition migration fresh install and historical upgrade",
  () => {
    it(
      "seeds S11 privately once and imports legacy content without overwriting DB revisions",
      async () =>
        isolated(async (pool, connection) => {
          await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
          expect(
            (
              await pool.query(
                "SELECT default_appearance, revision FROM site_settings",
              )
            ).rows,
          ).toEqual([{ default_appearance: "default", revision: 0 }]);
          await pool.query(
            "UPDATE site_settings SET default_appearance='cute-pastel', revision=1 WHERE id=1",
          );
          await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
          expect(
            (
              await pool.query(
                "SELECT default_appearance, revision FROM site_settings",
              )
            ).rows,
          ).toEqual([{ default_appearance: "cute-pastel", revision: 1 }]);
          const initial = (
            await pool.query("SELECT * FROM edition_state WHERE slug='s11'")
          ).rows[0];
          expect(initial.configuration).toMatchObject({
            published: false,
            rules: null,
            eligibility: null,
            registration: null,
            schedule: [],
            branding: bootstrap[0].branding,
          });
          vi.stubEnv("DATABASE_URL", connection);
          const legacy = {
            ...edition,
            slug: "s11",
            published: true,
            name: "Approved synthetic legacy edition",
            season: "11",
            branding: bootstrap[0].branding,
          };
          await expect(importLegacyEditions([legacy])).rejects.toThrow(
            /already has database content/,
          );
          expect(await importLegacyEditions([legacy], true)).toEqual({
            imported: 1,
            unchanged: 0,
          });
          expect(await importLegacyEditions([legacy], true)).toEqual({
            imported: 0,
            unchanged: 1,
          });
          const imported = (
            await pool.query(
              "SELECT configuration, configuration_version FROM edition_state WHERE slug='s11'",
            )
          ).rows[0];
          expect(imported.configuration.published).toBe(false);
          expect(imported.configuration.registration.enabled).toBe(false);
          expect(imported.configuration_version).toBe(1);
          await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
          expect(
            (
              await pool.query(
                "SELECT configuration FROM edition_state WHERE slug='s11'",
              )
            ).rows[0].configuration,
          ).toEqual(imported.configuration);
          await pool.query(
            "UPDATE edition_state SET configuration = jsonb_set(configuration, '{name}', '\"Newer database edit\"'), configuration_version = 2 WHERE slug='s11'",
          );
          await expect(
            importLegacyEditions(
              [{ ...edition, slug: "additional" }, legacy],
              true,
            ),
          ).rejects.toThrow(/already has database content/);
          expect(
            (
              await pool.query(
                "SELECT slug FROM edition_state WHERE slug='additional'",
              )
            ).rowCount,
          ).toBe(0);
          expect(
            (
              await pool.query(
                "SELECT configuration->>'name' AS name FROM edition_state WHERE slug='s11'",
              )
            ).rows[0].name,
          ).toBe("Newer database edit");
        }),
      60000,
    );
    it(
      "upgrades populated 0012 anchors without changing acknowledgments, teams, draft, pools or result data",
      async () =>
        isolated(async (pool) => {
          const folder = mkdtempSync(join(tmpdir(), "oclr-before-editions-"));
          try {
            cpSync("./drizzle", folder, { recursive: true });
            const path = join(folder, "meta/_journal.json");
            const journal = JSON.parse(readFileSync(path, "utf8"));
            journal.entries = journal.entries.filter(
              (e: { idx: number }) => e.idx < 13,
            );
            writeFileSync(path, JSON.stringify(journal));
            await migrate(drizzle(pool), { migrationsFolder: folder });
            const t1 = randomUUID(),
              t2 = randomUUID(),
              session = randomUUID(),
              stage = randomUUID(),
              round = randomUUID(),
              maps = randomUUID(),
              fixture = randomUUID(),
              source = randomUUID();
            await pool.query(
              "INSERT INTO edition_state (slug, locked_at, setup_version, pool_published) VALUES ('s11',now(),7,true),('legacy-unknown',null,0,false)",
            );
            await pool.query(
              "INSERT INTO users (osu_id, username) VALUES (1,'Synthetic Captain'),(2,'Synthetic Player'),(3,'Synthetic Opponent')",
            );
            await pool.query(
              "INSERT INTO registrations (edition_slug,user_id,status,rules_version,answers) VALUES ('s11',1,'accepted','original-v1','{}'),('s11',2,'accepted','original-v1','{\"old_question\":\"PRIVATE_SAVED_ANSWER\"}')",
            );
            await pool.query(
              "INSERT INTO captains (edition_slug,user_id,position) VALUES ('s11',1,0),('s11',3,1)",
            );
            await pool.query(
              "INSERT INTO teams (id,edition_slug,captain_id,name,finalized_at) VALUES ($1,'s11',1,'Synthetic A',now()),($2,'s11',3,'Synthetic B',now())",
              [t1, t2],
            );
            await pool.query(
              "INSERT INTO memberships (edition_slug,team_id,user_id,origin) VALUES ('s11',$1,2,'draft')",
              [t1],
            );
            await pool.query(
              "INSERT INTO draft_sessions (id,edition_slug,state,version,turn_index,turn_sequence,pool) VALUES ($1,'s11','paused',4,1,$2,'[2]')",
              [session, JSON.stringify([t1, t2])],
            );
            await pool.query(
              "INSERT INTO draft_picks (session_id,turn_index,team_id,captain_id,player_id,actor_id,mode,request_key,request_hash,revision) VALUES ($1,0,$2,1,2,1,'captain_direct',$3,'synthetic-hash',4)",
              [session, t1, randomUUID()],
            );
            await pool.query(
              "INSERT INTO tournament_stages (id,edition_slug,kind) VALUES ($1,'s11','group')",
              [stage],
            );
            await pool.query(
              "INSERT INTO tournament_rounds (id,edition_slug,stage_id,name,position) VALUES ($1,'s11',$2,'Synthetic Round',1)",
              [round, stage],
            );
            await pool.query(
              "INSERT INTO mappools (id,edition_slug,round_id,name) VALUES ($1,'s11',$2,'Synthetic historical pool')",
              [maps, round],
            );
            await pool.query(
              "INSERT INTO mappool_entries (pool_id,category,position,beatmap_id,metadata) VALUES ($1,'NM',1,123,$2)",
              [
                maps,
                JSON.stringify({
                  setId: 42,
                  title: "Synthetic Song",
                  artist: "Synthetic Artist",
                  difficulty: "Synthetic Difficulty",
                  mapper: "Synthetic Mapper",
                  stars: 4,
                  bpm: 180,
                  duration: 90,
                }),
              ],
            );
            await pool.query(
              "INSERT INTO fixtures (id,edition_slug,round_id,label,home_team_id,away_team_id,time_zone,mappool_id,position) VALUES ($1,'s11',$2,'Synthetic historical fixture',$3,$4,'UTC',$5,1)",
              [fixture, round, t1, t2, maps],
            );
            // Opaque historical provider/revision payloads must survive migration without normalization.
            await pool.query(
              "INSERT INTO match_imports (id,fixture_id,external_match_id,fingerprint,source,created_by) VALUES ($1,$2,999001,'synthetic-fingerprint','{\"historical_provider_snapshot\":true}',1)",
              [source, fixture],
            );
            await pool.query(
              "INSERT INTO match_results (fixture_id,state,version,current_revision,latest_import_id,published_revision,published_at) VALUES ($1,'approved',3,1,$2,1,now())",
              [fixture, source],
            );
            await pool.query(
              "INSERT INTO result_revisions (fixture_id,revision,import_id,proposal,created_by,approved_by,approved_at) VALUES ($1,1,$2,'{\"historical_reviewed_snapshot\":true}',1,1,now())",
              [fixture, source],
            );
            await pool.query(
              "INSERT INTO match_games (import_id,external_game_id,beatmap_id,data) VALUES ($1,7,123,'{\"historical_game_snapshot\":true}')",
              [source],
            );
            await pool.query(
              "INSERT INTO result_audit_events (fixture_id,actor_id,action,reason,detail) VALUES ($1,1,'result_publish','Original substantive decision','{\"historical_audit\":true}')",
              [fixture],
            );
            await pool.query(
              "INSERT INTO result_game_claims (edition_slug,external_game_id,fixture_id) VALUES ('s11',7,$1)",
              [fixture],
            );
            await pool.query(
              "INSERT INTO staff_roles (user_id,edition_slug,role,granted_by) VALUES (1,'s11','admin',1)",
            );
            await pool.query(
              "INSERT INTO edition_events (edition_slug,actor_id,kind,reason,detail) VALUES ('s11',1,'legacy_setup','Historical operator note','{\"historical_setup\":true}')",
            );
            const tables = (
              await pool.query(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'edition_state' ORDER BY tablename",
              )
            ).rows.map((r) => r.tablename as string);
            const before = new Map<string, unknown>();
            for (const table of tables)
              before.set(
                table,
                (
                  await pool.query(
                    `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
                  )
                ).rows,
              );
            const anchor = (
              await pool.query(
                "SELECT slug,locked_at,setup_version,pool_published FROM edition_state ORDER BY slug",
              )
            ).rows;
            await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
            expect(
              (
                await pool.query(
                  "SELECT default_appearance, revision FROM site_settings",
                )
              ).rows,
            ).toEqual([{ default_appearance: "default", revision: 0 }]);
            expect(
              (
                await pool.query(
                  "SELECT registration_paused_at = locked_at AS preserved FROM edition_state WHERE locked_at IS NOT NULL",
                )
              ).rows.every((r) => r.preserved),
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "SELECT registration_paused_at FROM edition_state WHERE locked_at IS NULL",
                )
              ).rows.every((r) => r.registration_paused_at === null),
            ).toBe(true);
            await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
            expect(
              (
                await pool.query(
                  "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='fixtures' AND column_name IN ('home_team_id', 'away_team_id') ORDER BY column_name",
                )
              ).rows,
            ).toEqual([
              { column_name: "away_team_id", is_nullable: "YES" },
              { column_name: "home_team_id", is_nullable: "YES" },
            ]);
            expect(
              (
                await pool.query(
                  "SELECT assignment_revision, stream_revision FROM fixtures",
                )
              ).rows,
            ).toEqual([{ assignment_revision: 0, stream_revision: 0 }]);
            expect(
              (await pool.query("SELECT about_published FROM staff_roles"))
                .rows,
            ).toEqual([{ about_published: false }]);
            expect(
              (await pool.query("SELECT source FROM registrations")).rows.every(
                (row) => row.source === "player",
              ),
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "SELECT eligibility_verification FROM registrations",
                )
              ).rows.every((r) => r.eligibility_verification === null),
            ).toBe(true);
            expect(
              (await pool.query("SELECT avatar_key FROM teams")).rows.every(
                (r) => r.avatar_key === null,
              ),
            ).toBe(true);
            expect(
              (
                await pool.query("SELECT attempt FROM registrations")
              ).rows.every((r) => r.attempt === 1),
            ).toBe(true);
            for (const table of tables)
              expect(
                (
                  await pool.query(
                    `SELECT ${table === "registrations" ? "to_jsonb(t) - 'configuration_version' - 'eligibility_acknowledged' - 'source' - 'eligibility_verification' - 'attempt'" : table === "fixtures" ? "to_jsonb(t) - 'assignment_revision' - 'stream_revision'" : table === "staff_roles" ? "to_jsonb(t) - 'about_published'" : table === "teams" ? "to_jsonb(t) - 'avatar_key'" : "to_jsonb(t)"} AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
                  )
                ).rows,
              ).toEqual(before.get(table));
            expect(
              (
                await pool.query(
                  "SELECT slug,locked_at,setup_version,pool_published FROM edition_state ORDER BY slug",
                )
              ).rows,
            ).toEqual(anchor);
            expect(
              (
                await pool.query(
                  "SELECT rules_version, eligibility_acknowledged FROM registrations",
                )
              ).rows.every(
                (row) =>
                  row.rules_version === "original-v1" &&
                  row.eligibility_acknowledged === null,
              ),
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "SELECT is_nullable FROM information_schema.columns WHERE table_name='registrations' AND column_name='rules_version'",
                )
              ).rows[0].is_nullable,
            ).toBe("YES");
            expect(
              (
                await pool.query(
                  "SELECT configuration_version FROM registrations",
                )
              ).rows.every((r) => r.configuration_version === null),
            ).toBe(true);
            expect(
              (
                await pool.query(
                  "SELECT configuration FROM edition_state WHERE slug='legacy-unknown'",
                )
              ).rows[0].configuration,
            ).toBeNull();
            expect(
              (
                await pool.query(
                  "SELECT configuration FROM edition_state WHERE slug='s11'",
                )
              ).rows[0].configuration.published,
            ).toBe(false);
          } finally {
            rmSync(folder, { recursive: true, force: true });
          }
        }),
      60000,
    );
  },
);

describe.skipIf(!base)("registration operation provenance migration", () => {
  it("adds nullable provenance without inventing historical attribution or losing acknowledgments", async () =>
    isolated(async (pool) => {
      const folder = mkdtempSync(join(tmpdir(), "oclr-107-migration-test-"));
      try {
        cpSync("drizzle", folder, { recursive: true });
        const file = join(folder, "meta/_journal.json");
        const journal = JSON.parse(readFileSync(file, "utf8"));
        journal.entries = journal.entries.filter(
          (entry: { idx: number }) => entry.idx < 23,
        );
        writeFileSync(file, JSON.stringify(journal));
        await migrate(drizzle(pool), { migrationsFolder: folder });
        await pool.query(
          "INSERT INTO users (osu_id,username) VALUES (710001,'Synthetic historical registrant')",
        );
        const registration = (
          await pool.query(
            "INSERT INTO registrations (edition_slug,user_id,status,rules_version,answers) VALUES ('s11',710001,'withdrawn','original-consent-v1','{\"private\":\"original answer\"}') RETURNING *",
          )
        ).rows[0];
        const event = (
          await pool.query(
            "INSERT INTO registration_events (registration_id,actor_id,from_status,to_status,reason) VALUES ($1,710001,'pending','withdrawn','Historical explanation') RETURNING *",
            [registration.id],
          )
        ).rows[0];
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query("SELECT * FROM registrations WHERE id=$1", [
              registration.id,
            ])
          ).rows[0],
        ).toEqual({ ...registration, attempt: 1 });
        expect(
          (
            await pool.query("SELECT * FROM registration_events WHERE id=$1", [
              event.id,
            ])
          ).rows[0],
        ).toEqual({ ...event, operation: null, attempt: 1 });
        await expect(
          pool.query(
            "INSERT INTO registration_events (registration_id,to_status,operation) VALUES ($1,'withdrawn','forged-operation')",
            [registration.id],
          ),
        ).rejects.toThrow();
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM registration_events",
            )
          ).rows[0].count,
        ).toBe(1);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }));
});

describe.skipIf(!base)("Yumu award policy upgrade", () => {
  it("preserves a persisted legacy award configuration and release, including repeated migration", async () =>
    isolated(async (pool) => {
      const folder = mkdtempSync(join(tmpdir(), "oclr-yumu-upgrade-test-"));
      try {
        cpSync("drizzle", folder, { recursive: true });
        const file = join(folder, "meta/_journal.json");
        const journal = JSON.parse(readFileSync(file, "utf8"));
        journal.entries = journal.entries.filter(
          (entry: { idx: number }) => entry.idx < 33,
        );
        writeFileSync(file, JSON.stringify(journal));
        await migrate(drizzle(pool), { migrationsFolder: folder });
        await pool.query(
          "INSERT INTO edition_state (slug) VALUES ('legacy-rating-test')",
        );
        const weeks = [
          {
            number: 1,
            startsAt: "2026-10-01T00:00:00Z",
            endsAt: "2026-10-08T00:00:00Z",
          },
        ];
        await pool.query(
          "INSERT INTO award_settings (edition_slug,version,weeks) VALUES ('legacy-rating-test',7,$1)",
          [JSON.stringify(weeks)],
        );
        const legacy = (
          await pool.query(
            "INSERT INTO weekly_award_releases (edition_slug,week,revision,fingerprint,report,published_by) VALUES ('legacy-rating-test',1,2,'persisted-source',$1,1) RETURNING *",
            [
              JSON.stringify({
                policy: "relative-game-mean-v1",
                candidates: [{ userId: 1, performance: 1000000000 }],
                mvp: [1],
                mip: [],
                rookie: [],
              }),
            ],
          )
        ).rows[0];
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query(
              "SELECT version,weeks,policy FROM award_settings WHERE edition_slug='legacy-rating-test'",
            )
          ).rows,
        ).toEqual([{ version: 7, weeks, policy: "relative-game-mean-v1" }]);
        expect(
          (
            await pool.query(
              "SELECT * FROM weekly_award_releases WHERE edition_slug='legacy-rating-test'",
            )
          ).rows,
        ).toEqual([legacy]);
        await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
        expect(
          (
            await pool.query(
              "SELECT * FROM weekly_award_releases WHERE edition_slug='legacy-rating-test'",
            )
          ).rows,
        ).toEqual([legacy]);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }));
});
