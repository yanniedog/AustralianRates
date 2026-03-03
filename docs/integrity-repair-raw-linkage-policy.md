# Raw Linkage Repair Policy (PR9)

## Purpose
This policy defines how `raw_payloads.content_hash` rows with no matching `raw_objects.content_hash` are classified and what classes are eligible for future repair.

This document is design-only for PR9. No production mutation is performed in this phase.

## Canonical definition

`raw linkage orphan` means:

```sql
SELECT rp.id, rp.source_type, rp.source_url, rp.content_hash
FROM raw_payloads rp
LEFT JOIN raw_objects ro
  ON ro.content_hash = rp.content_hash
WHERE ro.content_hash IS NULL;
```

`repairable orphan` means an orphan hash with sufficient evidence to create a deterministic, idempotent `raw_objects` row candidate without guessing content bytes.

## Classification buckets

Classification is evaluated at the orphan-hash level using:
- `source_type`
- `source_url` pattern
- presence in `fetch_events`
- normalised-hash match against existing `raw_objects` (trim/lower comparison only)
- orphan payload multiplicity

Primary buckets:
- `legacy_wayback_html`
- `likely_missing_raw_object_row`
- `normalized_hash_match_existing_object`
- `missing_fetch_event_metadata`
- `other_source`

## Future remediation policy (PR10 target)

| Bucket | Allowed strategy | Default action in PR9 | Notes |
|---|---|---|---|
| `likely_missing_raw_object_row` | Insert missing `raw_objects` row if deterministic source evidence exists | Plan as `INSERT_RAW_OBJECT` | Must be idempotent by `content_hash` |
| `normalized_hash_match_existing_object` | Link to existing canonical hash (no delete) | Plan as `LINK_EXISTING` | Requires explicit mapping evidence; no destructive edits |
| `legacy_wayback_html` | Exclude from mutation by default | Plan as `SKIP_LEGACY` | Track separately; manual approval required |
| `missing_fetch_event_metadata` | No automatic mutation | Plan as `SKIP_UNKNOWN` | Needs manual investigation or stronger evidence |
| `other_source` | No automatic mutation | Plan as `SKIP_UNKNOWN` | Manual review gate |

## Non-negotiable production safety rules

Any future production repair tool must enforce all of:
- backup export created and path supplied
- `--remote` required
- allowlisted DB only: `australianrates_api`
- staged sequence: plan-only -> independent verification -> insert-only apply
- delete/bounded cleanup disabled by default
- no deploy commands, no migrations
- explicit dangerous acknowledgement flag for any mutation mode

## PR9 to PR10 gate criteria

Move to PR10 only when all are true:
1. Plan-only counts are stable across repeated runs (`--repeat`) on production.
2. Offline simulation output is deterministic on the same clone (same hashes and bucket totals).
3. Planned actions are fully distributed across known buckets; unknown bucket ratio is explicitly reported.
4. Proposed mutation SQL is idempotent and scope-limited to raw linkage tables only.
5. Pre/post verification queries are defined and replayable.
6. Rollback process references a validated backup artifact.

## Out of scope in PR9

- Any production data mutation
- Any D1 schema migration
- Any Worker runtime behaviour change
