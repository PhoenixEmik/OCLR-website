# YumuRating

OCLR adapts the mathematical rating model from [yumu-bot](https://github.com/yumu-bot/yumu-bot/tree/8b52582efaa621eec26e6ce9151924435c96a3d4), pinned commit `8b52582efaa621eec26e6ce9151924435c96a3d4`, `MatchRating.kt` blob `585b6886c52f508a4cb07c1026796159b389aea9`. The upstream is Apache-2.0; its license is preserved in `LICENSES/yumu-bot-Apache-2.0.txt`. OCLR's TypeScript adaptation and deviations are described here and in the source header. No upstream NOTICE file exists at this pinned revision.

## Single-fixture policy `yumu-mra-v1`

Only approved and published result revision pointers are read, never the latest import or pending correction. The adapter verifies game claims, scoring mode, source fingerprint, round and ordered fixture-team attribution. Effective score follows the approved failed-score policy. Games excluded by the reviewed proposal never enter the rating. A fixture's approved source may contain games from completed MP source histories; game ID, not room count or beatmap ID, defines a sample. A later legitimate play of the same beatmap is retained.

For game g, n_g is the number of observed, attributed scores (including valid zero scores), S_g their effective-score sum. For player i:

- `RRA_ig = score_ig * n_g / S_g`.
- `TMG_i = sum(RRA_ig)`; `AMG_i = TMG_i / appearances_i`.
- `A = mean(AMG_i)` over the union of actually scoring players; `MQ_i = AMG_i / A`.
- `s = 0` for N <= 2, otherwise `2 / (1 + exp(0.5 - 0.25*N)) - 1`.
- `ERA_i = (MQ_i - min(MQ)*s) / (1 - min(MQ)*s)`.
- `DRA_i = TMG_i * N / total_score_record_count`.
- **`MRA_i = 0.7*ERA_i + 0.3*DRA_i`**, higher first.
- Per-game RWS is the player's score divided by their winning team's total, only for an approved winning team; losing teams and tied games contribute zero. Player RWS is the mean over actual appearances.

Computations use JavaScript binary64 in ascending game ID / player ID order; published metrics round to nearest 9 decimals (nonnegative half up). Rank comparisons use these metrics. Equal MRA retains competition rank ties; UID only orders display rows. Percentile inputs use average tied positions divided by N-1 (0 is best, 1 worst); RWS is ordered by RWS then DRA as upstream does. A single player's percentile inputs are null. Small comparison populations are explicitly labeled. These are relative population measures, not globally comparable skill scores.

To avoid cancellation for large N, the ERA implementation uses the complementary scaling factor. Its continuous equal-population limit is ERA=1 when the complement underflows. Invalid/unsafe scores, zero-sum games, conflicting duplicate game identities, unresolved teams or missing sources mark the report unavailable; no fabricated metric or partial official table is emitted. Valid zero scores still count as appearances and contribute RRA=0, unlike upstream's zero-score skip. No upstream low-score deletion, same-BID deduplication, skip/ignore or EZ multiplier is reapplied to approved scores.

**Single-fixture ratings never use SR.** No weight option or provider SR lookup exists. Beatmap metadata updates cannot alter scores. Ratings are derived from immutable approved result inputs and the named policy; source revision/fingerprint evidence accompanies them. Reapproving a correction changes the derived report only after the existing result review/publication transaction. No second score store or rating-specific mutation is introduced. Public projection runs within one repeatable-read snapshot, reuses fixture/progression/team publication checks and withholds a report if any scoring identity is not public. Admin reads remain edition-scoped. Legacy weekly award calculations are unchanged by #192.

## Rounds and weekly awards (#193)

`SeriesRating.kt` blob `091791e0d5c315f176a45a58c659b8932e3fc0a8` at the same pinned upstream commit is the reference. Each edition/stage/round is reaggregated from its approved raw games and player union; group-scoped tables use only fixtures between published group members. This is not an average of fixture MRA or class labels. Coverage counts describe published fixtures; an unpublished fixture or private scoring identity prevents a complete-round claim. Missing or invalid games withhold numeric standings. Admin previews reuse the same engine, with private authorization and full coverage awareness.

Yumu weekly publication is blocked while scheduled, non-cancelled fixtures in that week lack approved published game data; an incomplete round cannot silently produce final weekly winners.

Weekly awards keep the configured calendar (start inclusive, end exclusive) and whole-fixture scheduled-time assignment. A week may contain multiple rounds; all its raw games are reaggregated together. Round membership and approval fingerprints are captured in new-policy reports, so corrections and moves invalidate affected reports and following-week MIP. Weekly and round MRA need not be numerically equal because populations differ. MIP uses absolute adjacent-week MRA gain with the same policy, with a warning that population normalization can itself influence changes. It remains a relative tournament metric, not proof of absolute skill improvement.

Migration `0033_yumu_award_policy.sql` adds one policy column with a **legacy default** for already-existing configuration rows. It does not change old reports or publish winners. New workspaces initially suggest `yumu-mra-v1`; Admin deliberately saves the selected policy and reviews before publishing. Existing configurations retain `relative-game-mean-v1`, and old releases retain their old policy/values. Changing policy marks affected current releases stale until deliberate republishing; every immutable historical row remains retained. Legacy report structure/source fingerprints are preserved. The source adapter is shared, not a second score store. MVP >=6, MIP >=5 in both adjacent weeks with positive gain, Rookie >=5 and draft Tier >=4 remain unchanged; Captain 0 and unknown Tier never qualify for Rookie. MRA and deltas display as rating numbers, never misleading percentages.

### Difficulty weighting decision

This release adopts **no SR weighting** in either fixture or series metrics. Single-fixture weighting is forbidden by organizer instruction. Series weighting remains optional and is not enabled without a reviewed, versioned formula. Multiplying every score on one game by the same SR cancels exactly in RRA. Weighting its later contribution would change the map mixture instead: a 4-star game with RRA=2 and an 8-star game with RRA=0.5 has unweighted AMG=1.25 but an SR-weighted mean `(4*2+8*0.5)/12=1`. Reversing which map is difficult yields 1.5 despite identical relative-score samples. This rewards/punishes map assignment as well as performance, and actual FM/variable-rate SR is not always available. The neutral baseline therefore remains adopted; there is no hidden SR fallback, extra provider dependency or optional switch in this release. A future approved SeriesRating policy must specify actual Mods, weighting step/caps, missing-SR behavior and comparative samples before publication.
