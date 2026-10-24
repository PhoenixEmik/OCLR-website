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
