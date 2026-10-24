import { sql } from "drizzle-orm";
import {
  pgEnum,
  check,
  integer,
  boolean,
  primaryKey,
  foreignKey,
  uniqueIndex,
  jsonb,
  uuid,
  unique,
  bigint,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
export const users = pgTable("users", {
  osuId: bigint("osu_id", { mode: "number" }).primaryKey(),
  username: text("username").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
// One site-wide default; visitor cookies remain independent overrides.
export const siteSettings = pgTable(
  "site_settings",
  {
    id: integer("id").primaryKey().default(1),
    defaultAppearance: text("default_appearance")
      .$type<import("@/lib/preferences").Appearance>()
      .notNull()
      .default("default"),
    revision: integer("revision").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("site_settings_singleton", sql`${t.id} = 1`),
    check("site_settings_revision", sql`${t.revision} >= 0`),
    check(
      "site_settings_appearance",
      sql`${t.defaultAppearance} IN ('default', 'cute-pastel', 'swiss-minimal')`,
    ),
  ],
);
export const siteSettingEvents = pgTable(
  "site_setting_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: bigint("actor_id", { mode: "number" }).references(
      () => users.osuId,
      { onDelete: "set null" },
    ),
    before: text("before_appearance").notNull(),
    after: text("after_appearance").notNull(),
    revision: integer("revision").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("site_setting_events_revision", sql`${t.revision} > 0`),
    check(
      "site_setting_events_appearances",
      sql`${t.before} IN ('default', 'cute-pastel', 'swiss-minimal') AND ${t.after} IN ('default', 'cute-pastel', 'swiss-minimal') AND ${t.before} <> ${t.after}`,
    ),
  ],
);
// Compact public provider projection; independent of OAuth identities/participation.
export const userProfileCache = pgTable(
  "user_profile_cache",
  {
    osuId: bigint("osu_id", { mode: "number" }).notNull(),
    mode: text("mode").notNull(),
    profile:
      jsonb("profile").$type<
        import("@/lib/osu-profile-model").OsuUserProfile
      >(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true }).notNull(),
    refreshToken: uuid("refresh_token"),
    errorStatus: integer("error_status"),
  },
  (t) => [
    primaryKey({ columns: [t.osuId, t.mode] }),
    index("user_profile_cache_attempt_idx").on(t.attemptedAt),
    check(
      "user_profile_cache_id_positive",
      sql`${t.osuId} > 0 AND ${t.osuId} <= 9007199254740991`,
    ),
    check(
      "user_profile_cache_mode",
      sql`${t.mode} IN ('osu', 'taiko', 'fruits', 'mania')`,
    ),
  ],
);
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("sessions_expiry_idx").on(table.expiresAt),
    index("sessions_user_idx").on(table.userId),
  ],
);
export const oauthStates = pgTable(
  "oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("oauth_states_expiry_idx").on(table.expiresAt)],
);

export const registrationStatus = pgEnum("registration_status", [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
]);
export const editionState = pgTable("edition_state", {
  slug: text("slug").primaryKey(),
  configuration:
    jsonb("configuration").$type<
      import("../lib/editions").EditionConfiguration
    >(),
  configurationVersion: integer("configuration_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  configurationUpdatedAt: timestamp("configuration_updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  registrationPausedAt: timestamp("registration_paused_at", {
    withTimezone: true,
  }),
  setupVersion: integer("setup_version").notNull().default(0),
  poolPublished: boolean("pool_published").notNull().default(false),
});
export const editionRevisions = pgTable(
  "edition_revisions",
  {
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    version: integer("version").notNull(),
    configuration: jsonb("configuration")
      .$type<import("../lib/editions").EditionConfiguration>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.editionSlug, t.version] })],
);
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId, { onDelete: "cascade" }),
    status: registrationStatus("status").notNull().default("pending"),
    source: text("source")
      .$type<"player" | "staff">()
      .notNull()
      .default("player"),
    rulesVersion: text("rules_version"),
    eligibilityAcknowledged: boolean("eligibility_acknowledged"),
    eligibilityVerification: jsonb("eligibility_verification").$type<
      import("@/lib/eligibility-model").EligibilityVerification
    >(),
    configurationVersion: integer("configuration_version"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull(),
    attempt: integer("attempt").notNull().default(1),
    statusReason: text("status_reason"),
    draftUnavailableReason: text("draft_unavailable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "registrations_configuration_fk",
      columns: [table.editionSlug, table.configurationVersion],
      foreignColumns: [editionRevisions.editionSlug, editionRevisions.version],
    }),
    check(
      "registrations_source_valid",
      sql`${table.source} IN ('player', 'staff')`,
    ),
    check(
      "registrations_staff_no_ack",
      sql`${table.source} <> 'staff' OR (${table.rulesVersion} IS NULL AND ${table.eligibilityAcknowledged} IS NULL AND ${table.answers} = '{}'::jsonb)`,
    ),
    unique("registrations_edition_user_unique").on(
      table.editionSlug,
      table.userId,
    ),
    index("registrations_status_idx").on(table.editionSlug, table.status),
    check("registrations_attempt_positive", sql`${table.attempt} > 0`),
  ],
);
export type RegistrationAttemptSnapshot = Omit<
  typeof registrations.$inferSelect,
  "createdAt" | "updatedAt"
> & { createdAt: string; updatedAt: string };
export const registrationAttempts = pgTable(
  "registration_attempts",
  {
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    configurationVersion: integer("configuration_version"),
    snapshot: jsonb("snapshot").$type<RegistrationAttemptSnapshot>().notNull(),
    archivedBy: bigint("archived_by", { mode: "number" }).references(
      () => users.osuId,
      { onDelete: "set null" },
    ),
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.registrationId, t.attempt] }),
    check("registration_attempts_positive", sql`${t.attempt} > 0`),
    foreignKey({
      name: "registration_attempts_configuration_fk",
      columns: [t.editionSlug, t.configurationVersion],
      foreignColumns: [editionRevisions.editionSlug, editionRevisions.version],
    }),
  ],
);
export const registrationEvents = pgTable(
  "registration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id, { onDelete: "cascade" }),
    actorId: bigint("actor_id", { mode: "number" }).references(
      () => users.osuId,
      { onDelete: "set null" },
    ),
    operation: text("operation").$type<
      "staff_remove" | "staff_restore" | "player_withdraw" | "player_reapply"
    >(),
    attempt: integer("attempt").notNull().default(1),
    fromStatus: registrationStatus("from_status"),
    toStatus: registrationStatus("to_status").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("registration_events_registration_idx").on(table.registrationId),
    check(
      "registration_events_operation_valid",
      sql`${table.operation} IS NULL OR ${table.operation} IN ('staff_remove', 'staff_restore', 'player_withdraw', 'player_reapply')`,
    ),
    check("registration_events_attempt_positive", sql`${table.attempt} > 0`),
  ],
);

export const captains = pgTable(
  "captains",
  {
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    position: integer("position").notNull(),
    published: boolean("published").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.editionSlug, table.userId] }),
    unique("captains_edition_position_unique").on(
      table.editionSlug,
      table.position,
    ),
  ],
);
export const editionEvents = pgTable(
  "edition_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    actorId: bigint("actor_id", { mode: "number" }).references(
      () => users.osuId,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    reason: text("reason"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("edition_events_edition_idx").on(table.editionSlug)],
);

// Classification is edition/ruleset-specific; the source inventory fingerprint
// invalidates it when upstream badges change. Private evidence stays in audit.
export const badgeReviews = pgTable(
  "badge_reviews",
  {
    editionSlug: text("edition_slug").notNull(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    mode: text("mode")
      .$type<import("@/lib/osu-profile-model").ProfileMode>()
      .notNull(),
    fingerprint: text("fingerprint").notNull(),
    classifications: jsonb("classifications")
      .$type<import("@/lib/bws-model").BadgeClassification[]>()
      .notNull(),
    version: integer("version").notNull().default(1),
    reviewedBy: bigint("reviewed_by", { mode: "number" }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.editionSlug, t.userId, t.mode] }),
    foreignKey({
      columns: [t.editionSlug, t.userId],
      foreignColumns: [registrations.editionSlug, registrations.userId],
    }),
    check(
      "badge_review_mode",
      sql`${t.mode} IN ('osu', 'taiko', 'fruits', 'mania')`,
    ),
    check("badge_review_version", sql`${t.version} > 0`),
    check(
      "badge_review_inventory",
      sql`jsonb_typeof(${t.classifications}) = 'array' AND jsonb_array_length(${t.classifications}) <= 100`,
    ),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    captainId: bigint("captain_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    avatarKey: uuid("avatar_key"),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    identityPublished: boolean("identity_published").notNull().default(false),
    rosterPublished: boolean("roster_published").notNull().default(false),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("teams_id_edition_unique").on(table.id, table.editionSlug),
    uniqueIndex("teams_active_captain_unique")
      .on(table.editionSlug, table.captainId)
      .where(sql`${table.archivedAt} IS NULL`),
  ],
);
// Team support roles are separate from playing memberships and staff capabilities.
export const teamCoaches = pgTable(
  "team_coaches",
  {
    teamId: uuid("team_id").notNull(),
    editionSlug: text("edition_slug").notNull(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({
      columns: [t.teamId, t.editionSlug],
      foreignColumns: [teams.id, teams.editionSlug],
    }),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug").notNull(),
    teamId: uuid("team_id").notNull(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    origin: text("origin").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.teamId, table.editionSlug],
      foreignColumns: [teams.id, teams.editionSlug],
    }),
    uniqueIndex("membership_active_edition_user_unique")
      .on(table.editionSlug, table.userId)
      .where(sql`${table.leftAt} IS NULL`),
    index("membership_team_idx").on(table.teamId),
  ],
);

export const draftState = pgEnum("draft_state", [
  "setup",
  "ready",
  "live",
  "paused",
  "completed",
  "finalized",
  "aborted",
]);
export const draftSessions = pgTable("draft_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  editionSlug: text("edition_slug")
    .notNull()
    .unique()
    .references(() => editionState.slug),
  state: draftState("state").notNull().default("setup"),
  version: integer("version").notNull().default(0),
  turnIndex: integer("turn_index").notNull().default(0),
  turnSequence: jsonb("turn_sequence").$type<string[]>().notNull().default([]),
  pool: jsonb("pool").$type<number[]>().notNull().default([]),
  publicVersion: integer("public_version").notNull().default(0),
  publishedRevision: integer("published_revision").notNull().default(-1),
  publicSnapshot:
    jsonb("public_snapshot").$type<import("../lib/draft-types").DraftBoard>(),
  captainSnapshot:
    jsonb("captain_snapshot").$type<
      import("../lib/draft-types").CaptainBoard
    >(),
});
export const draftPicks = pgTable(
  "draft_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => draftSessions.id),
    turnIndex: integer("turn_index").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    captainId: bigint("captain_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    playerId: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    actorId: bigint("actor_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    mode: text("mode").$type<"captain_direct" | "staff_on_behalf">().notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    revision: integer("revision").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("draft_active_turn_unique")
      .on(table.sessionId, table.turnIndex)
      .where(sql`${table.voidedAt} IS NULL`),
    uniqueIndex("draft_active_player_unique")
      .on(table.sessionId, table.playerId)
      .where(sql`${table.voidedAt} IS NULL`),
    unique("draft_actor_request_unique").on(
      table.sessionId,
      table.actorId,
      table.requestKey,
    ),
  ],
);

export const staffRole = pgEnum("staff_role", [
  "admin",
  "mappooler",
  "referee",
  "developer",
  "streamer",
]);
export const staffRoles = pgTable(
  "staff_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId, { onDelete: "cascade" }),
    editionSlug: text("edition_slug").references(() => editionState.slug),
    role: staffRole("role").notNull(),
    grantedBy: bigint("granted_by", { mode: "number" }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    aboutPublished: boolean("about_published").notNull().default(false),
  },
  (t) => [
    uniqueIndex("staff_global_role_unique")
      .on(t.userId, t.role)
      .where(sql`${t.editionSlug} IS NULL AND ${t.revokedAt} IS NULL`),
    uniqueIndex("staff_scoped_role_unique")
      .on(t.userId, t.role, t.editionSlug)
      .where(sql`${t.editionSlug} IS NOT NULL AND ${t.revokedAt} IS NULL`),
    index("staff_roles_user_idx").on(t.userId),
    check(
      "developer_global_only",
      sql`${t.role}::text <> 'developer' OR ${t.editionSlug} IS NULL`,
    ),
  ],
);
export const staffRoleEvents = pgTable(
  "staff_role_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => staffRoles.id, { onDelete: "cascade" }),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    targetId: bigint("target_id", { mode: "number" }).notNull(),
    role: staffRole("role").notNull(),
    editionSlug: text("edition_slug"),
    action: text("action")
      .$type<"grant" | "revoke" | "publish_profile" | "hide_profile">()
      .notNull(),
    reason: text("reason"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("staff_role_events_grant_idx").on(t.grantId)],
);

export const stageKind = pgEnum("stage_kind", ["group", "knockout"]);
export const tournamentStages = pgTable(
  "tournament_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    kind: stageKind("kind").notNull(),
    version: integer("version").notNull().default(0),
    groupConfiguration: jsonb("group_configuration").$type<
      import("../lib/competition-model").GroupConfiguration
    >(),
    groupsPublishedAt: timestamp("groups_published_at", { withTimezone: true }),
  },
  (t) => [
    unique("stage_edition_kind_unique").on(t.editionSlug, t.kind),
    unique("stage_id_edition_unique").on(t.id, t.editionSlug),
  ],
);
export const tournamentRounds = pgTable(
  "tournament_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug").notNull(),
    stageId: uuid("stage_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(0),
    scoringRules:
      jsonb("scoring_rules").$type<
        import("../lib/competition-model").ScoringRules
      >(),
    standingsRules:
      jsonb("standings_rules").$type<
        import("../lib/competition-model").StandingsRules
      >(),
  },
  (t) => [
    foreignKey({
      columns: [t.stageId, t.editionSlug],
      foreignColumns: [tournamentStages.id, tournamentStages.editionSlug],
    }),
    unique("round_stage_position_unique").on(t.stageId, t.position),
    unique("round_id_edition_unique").on(t.id, t.editionSlug),
  ],
);
export const mappoolCategory = pgEnum("mappool_category", [
  "NM",
  "HD",
  "DT",
  "HR",
  "FM",
  "TB",
]);
export const fmMode = pgEnum("fm_mode", ["free_mod", "force_mod"]);
export const mappools = pgTable(
  "mappools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug").notNull(),
    roundId: uuid("round_id").notNull(),
    name: text("name").notNull(),
    fmMode: fmMode("fm_mode"),
    fmRestrictions: text("fm_restrictions").notNull().default(""),
    version: integer("version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.roundId, t.editionSlug],
      foreignColumns: [tournamentRounds.id, tournamentRounds.editionSlug],
    }),
    unique("pool_round_name_unique").on(t.roundId, t.name),
    unique("pool_id_edition_unique").on(t.id, t.editionSlug),
    unique("pool_id_round_edition_unique").on(t.id, t.roundId, t.editionSlug),
    index("pool_public_edition_idx").on(t.editionSlug, t.publishedAt),
  ],
);
export const mappoolEntries = pgTable(
  "mappool_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poolId: uuid("pool_id")
      .notNull()
      .references(() => mappools.id),
    category: mappoolCategory("category").notNull(),
    position: integer("position").notNull(),
    beatmapId: bigint("beatmap_id", { mode: "number" }).notNull(),
    metadata: jsonb("metadata")
      .$type<import("../lib/mappool-model").BeatmapMetadata>()
      .notNull(),
    metadataFetchedAt: timestamp("metadata_fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("pool_slot_unique").on(t.poolId, t.category, t.position),
    index("pool_entry_pool_idx").on(t.poolId),
  ],
);
export const mappoolEvents = pgTable(
  "mappool_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    poolId: uuid("pool_id").references(() => mappools.id),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("mappool_events_pool_idx").on(t.poolId)],
);

export const fixtureStatus = pgEnum("fixture_status", [
  "scheduled",
  "in_progress",
  "cancelled",
]);
export const fixtures = pgTable(
  "fixtures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug").notNull(),
    roundId: uuid("round_id").notNull(),
    label: text("label").notNull(),
    homeTeamId: uuid("home_team_id"),
    awayTeamId: uuid("away_team_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    timeZone: text("time_zone").notNull(),
    status: fixtureStatus("status").notNull().default("scheduled"),
    mappoolId: uuid("mappool_id"),
    position: integer("position").notNull(),
    homeSourceId: uuid("home_source_id"),
    homeSourceOutcome: text("home_source_outcome").$type<"winner" | "loser">(),
    awaySourceId: uuid("away_source_id"),
    awaySourceOutcome: text("away_source_outcome").$type<"winner" | "loser">(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    assignmentRevision: integer("assignment_revision").notNull().default(0),
    streamRevision: integer("stream_revision").notNull().default(0),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.roundId, t.editionSlug],
      foreignColumns: [tournamentRounds.id, tournamentRounds.editionSlug],
    }),
    foreignKey({
      columns: [t.homeTeamId, t.editionSlug],
      foreignColumns: [teams.id, teams.editionSlug],
    }),
    foreignKey({
      columns: [t.awayTeamId, t.editionSlug],
      foreignColumns: [teams.id, teams.editionSlug],
    }),
    foreignKey({
      columns: [t.mappoolId, t.roundId, t.editionSlug],
      foreignColumns: [mappools.id, mappools.roundId, mappools.editionSlug],
    }),
    foreignKey({
      columns: [t.homeSourceId, t.editionSlug],
      foreignColumns: [t.id, t.editionSlug],
    }),
    foreignKey({
      columns: [t.awaySourceId, t.editionSlug],
      foreignColumns: [t.id, t.editionSlug],
    }),
    unique("fixture_id_edition_unique").on(t.id, t.editionSlug),
    unique("fixture_round_position_unique").on(t.roundId, t.position),
    check("fixture_distinct_teams", sql`${t.homeTeamId} <> ${t.awayTeamId}`),
    check("fixture_positive_position", sql`${t.position} > 0`),
    check(
      "fixture_home_source_pair",
      sql`(${t.homeSourceId} IS NULL AND ${t.homeSourceOutcome} IS NULL) OR (${t.homeSourceId} IS NOT NULL AND ${t.homeSourceOutcome} IS NOT NULL AND ${t.homeSourceOutcome} IN ('winner', 'loser'))`,
    ),
    check(
      "fixture_away_source_pair",
      sql`(${t.awaySourceId} IS NULL AND ${t.awaySourceOutcome} IS NULL) OR (${t.awaySourceId} IS NOT NULL AND ${t.awaySourceOutcome} IS NOT NULL AND ${t.awaySourceOutcome} IN ('winner', 'loser'))`,
    ),
    index("fixtures_public_schedule_idx").on(
      t.editionSlug,
      t.publishedAt,
      t.scheduledAt,
    ),
  ],
);
export const fixtureReferees = pgTable(
  "fixture_referees",
  {
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    assignedBy: bigint("assigned_by", { mode: "number" }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fixtureId, t.userId] }),
    index("fixture_referee_user_idx").on(t.userId),
  ],
);
// One current Streamer per fixture. Immutable changes live in edition_events,
// so deleting an otherwise removable fixture preserves attribution/history.
export const fixtureStreams = pgTable(
  "fixture_streams",
  {
    fixtureId: uuid("fixture_id")
      .primaryKey()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    source: text("source").$type<"self" | "staff">().notNull(),
    assignedBy: bigint("assigned_by", { mode: "number" })
      .notNull()
      .references(() => users.osuId),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedScheduledAt: timestamp("confirmed_scheduled_at", {
      withTimezone: true,
    }),
    confirmedTimeZone: text("confirmed_time_zone").notNull(),
  },
  (t) => [
    index("fixture_streams_user_idx").on(t.userId),
    check("fixture_streams_source", sql`${t.source} IN ('self', 'staff')`),
  ],
);

export const matchImports = pgTable(
  "match_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id),
    externalMatchId: bigint("external_match_id", { mode: "number" }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    source: jsonb("source").$type<unknown>().notNull(),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("import_id_fixture_unique").on(t.id, t.fixtureId),
    unique("match_import_revision_unique").on(
      t.fixtureId,
      t.externalMatchId,
      t.fingerprint,
    ),
  ],
);
export const matchGames = pgTable(
  "match_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => matchImports.id),
    externalGameId: bigint("external_game_id", { mode: "number" }).notNull(),
    beatmapId: bigint("beatmap_id", { mode: "number" }),
    data: jsonb("data").$type<unknown>().notNull(),
  },
  (t) => [unique("match_import_game_unique").on(t.importId, t.externalGameId)],
);
export const resultState = pgEnum("result_state", [
  "draft",
  "submitted",
  "approved",
]);
export const matchResults = pgTable(
  "match_results",
  {
    fixtureId: uuid("fixture_id")
      .primaryKey()
      .references(() => fixtures.id),
    state: resultState("state").notNull().default("draft"),
    version: integer("version").notNull().default(0),
    currentRevision: integer("current_revision").notNull().default(0),
    latestImportId: uuid("latest_import_id"),
    publishedRevision: integer("published_revision"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.latestImportId, t.fixtureId],
      foreignColumns: [matchImports.id, matchImports.fixtureId],
    }),
  ],
);
export const resultRevisions = pgTable(
  "result_revisions",
  {
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => matchResults.fixtureId),
    revision: integer("revision").notNull(),
    importId: uuid("import_id").notNull(),
    proposal: jsonb("proposal").$type<unknown>().notNull(),
    reason: text("reason"),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedBy: bigint("approved_by", { mode: "number" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.fixtureId, t.revision] }),
    foreignKey({
      columns: [t.importId, t.fixtureId],
      foreignColumns: [matchImports.id, matchImports.fixtureId],
    }),
    check("result_revision_positive", sql`${t.revision} > 0`),
    check(
      "result_approval_actor_pair",
      sql`(${t.approvedAt} IS NULL AND ${t.approvedBy} IS NULL) OR (${t.approvedAt} IS NOT NULL AND ${t.approvedBy} IS NOT NULL)`,
    ),
  ],
);
export const resultAuditEvents = pgTable(
  "result_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id),
    actorId: bigint("actor_id", { mode: "number" }).notNull(),
    action: text("action").notNull(),
    requestKey: uuid("request_key"),
    requestHash: text("request_hash"),
    reason: text("reason"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("result_audit_fixture_idx").on(t.fixtureId),
    uniqueIndex("result_command_key_unique")
      .on(t.fixtureId, t.actorId, t.requestKey)
      .where(sql`${t.requestKey} IS NOT NULL`),
  ],
);
export const resultGameClaims = pgTable(
  "result_game_claims",
  {
    editionSlug: text("edition_slug").notNull(),
    externalGameId: bigint("external_game_id", { mode: "number" }).notNull(),
    fixtureId: uuid("fixture_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.editionSlug, t.externalGameId] }),
    foreignKey({
      columns: [t.fixtureId, t.editionSlug],
      foreignColumns: [fixtures.id, fixtures.editionSlug],
    }),
  ],
);

// Award releases are reviewed snapshots of the existing approved result pipeline.
export const awardSettings = pgTable(
  "award_settings",
  {
    editionSlug: text("edition_slug")
      .primaryKey()
      .references(() => editionState.slug),
    version: integer("version").notNull().default(0),
    policy: text("policy").notNull().default("relative-game-mean-v1"),
    weeks: jsonb("weeks")
      .$type<import("@/lib/award-model").AwardWeek[]>()
      .notNull()
      .default([]),
    tiers: jsonb("tiers")
      .$type<import("@/lib/award-model").AwardTier[]>()
      .notNull()
      .default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("award_settings_version", sql`${t.version} >= 0`)],
);
export const weeklyAwardReleases = pgTable(
  "weekly_award_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    week: integer("week").notNull(),
    revision: integer("revision").notNull(),
    fingerprint: text("fingerprint").notNull(),
    report: jsonb("report")
      .$type<import("@/lib/awards").AwardReport>()
      .notNull(),
    publishedBy: bigint("published_by", { mode: "number" }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("weekly_award_revision").on(t.editionSlug, t.week, t.revision),
    uniqueIndex("weekly_award_active")
      .on(t.editionSlug, t.week)
      .where(sql`${t.active}`),
    check("weekly_award_positive", sql`${t.week} > 0 AND ${t.revision} > 0`),
  ],
);

// MP-derived historical statistics have independent draft/release versions.
export const historicalStatistics = pgTable(
  "historical_statistics",
  {
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    mpId: bigint("mp_id", { mode: "number" }).notNull(),
    fixtureId: text("fixture_id").notNull(),
    version: integer("version").notNull().default(0),
    draft: jsonb("draft")
      .$type<import("@/lib/archive-statistics-model").StatisticsSnapshot>()
      .notNull(),
    published:
      jsonb("published").$type<
        import("@/lib/archive-statistics-model").StatisticsSnapshot
      >(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.editionSlug, t.mpId] }),
    check(
      "historical_statistics_version",
      sql.raw("version >= 0 AND mp_id > 0"),
    ),
  ],
);

// Immutable signed public messages; author and timestamp are the transactional write record.
export const playerMessages = pgTable(
  "player_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionSlug: text("edition_slug")
      .notNull()
      .references(() => editionState.slug),
    playerId: bigint("player_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId, { onDelete: "cascade" }),
    authorId: bigint("author_id", { mode: "number" })
      .notNull()
      .references(() => users.osuId, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("player_messages_author_request_unique").on(t.authorId, t.requestId),
    index("player_messages_target_idx").on(
      t.editionSlug,
      t.playerId,
      t.createdAt,
    ),
    index("player_messages_author_time_idx").on(t.authorId, t.createdAt),
    check(
      "player_messages_body_length",
      sql`char_length(btrim(${t.body})) BETWEEN 1 AND 1000`,
    ),
  ],
);
