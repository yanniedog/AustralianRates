-- Fix stale rba_cash_rates rows written by the old F1 CSV source for early 2026.
-- The F1 CSV was lagging: it stored each daily collection_date as its own effective_date
-- with the wrong cash_rate (3.85% instead of the correct 3.60% from the 2025-08-13 cut).
-- This caused spurious effective_date values in the chart's GROUP BY query, producing a
-- non-uniform x-axis and incorrect rate steps.
--
-- Correct values for all collection_dates from 2026-01-01 through 2026-03-17:
--   cash_rate    = 3.60  (RBA cut on 2025-08-13, in effect until 2026-03-18)
--   effective_date = '2025-08-13'
--
-- Rows from 2026-03-15 onwards will also be corrected by the 7-day rolling backfill
-- (which runs every 15 min via cron), but this migration handles the earlier rows that
-- fall outside the rolling window.

UPDATE rba_cash_rates
SET
  cash_rate      = 3.60,
  effective_date = '2025-08-13',
  source_url     = 'https://www.rba.gov.au/statistics/cash-rate/',
  fetched_at     = CURRENT_TIMESTAMP
WHERE collection_date >= '2026-01-01'
  AND collection_date <= '2026-03-17';
