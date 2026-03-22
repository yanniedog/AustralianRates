-- Back-fill one rba_cash_rates row per CPI quarter from Q1 2021 through Q4 2025.
-- Each row uses the RBA decision that was in effect on that quarter-start date
-- (i.e. the latestPointOnOrBefore logic), so the chart can draw the cash-rate
-- step line over the same date range as the CPI series.
--
-- Source: https://www.rba.gov.au/statistics/cash-rate/
-- ON CONFLICT DO NOTHING so live daily-collection rows are never overwritten.

INSERT INTO rba_cash_rates (collection_date, cash_rate, effective_date, source_url, fetched_at) VALUES
  -- 2021: rate at 0.10% (set 2020-11-04, unchanged through Apr 2022)
  ('2021-01-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2021-04-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2021-07-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2021-10-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q1 2022: still 0.10% (first hike was 2022-05-04)
  ('2022-01-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q2 2022: still 0.10% on 2022-04-01 (hike not until 2022-05-04)
  ('2022-04-01', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q3 2022: 0.85% on 2022-07-01 (hike to 0.85% on 2022-06-08; next hike 2022-07-06)
  ('2022-07-01', 0.85, '2022-06-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q4 2022: 2.35% on 2022-10-01 (hike to 2.35% on 2022-09-07; next hike 2022-10-05)
  ('2022-10-01', 2.35, '2022-09-07', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q1 2023: 3.10% on 2023-01-01 (hike to 3.10% on 2022-12-07)
  ('2023-01-01', 3.10, '2022-12-07', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q2 2023: 3.60% on 2023-04-01 (hike to 3.60% on 2023-03-08; next hike 2023-05-03)
  ('2023-04-01', 3.60, '2023-03-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q3 2023: 4.10% on 2023-07-01 (hike to 4.10% on 2023-06-07; next hike 2023-11-08)
  ('2023-07-01', 4.10, '2023-06-07', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q4 2023: 4.10% on 2023-10-01 (still in effect; hike to 4.35% not until 2023-11-08)
  ('2023-10-01', 4.10, '2023-06-07', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- 2024: 4.35% all year (set 2023-11-08, first cut not until 2025-02-19)
  ('2024-01-01', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2024-04-01', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2024-07-01', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  ('2024-10-01', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q1 2025: 4.35% on 2025-01-01 (cut to 4.10% not until 2025-02-19)
  ('2025-01-01', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q2 2025: 4.10% on 2025-04-01 (cut to 4.10% on 2025-02-19; next cut 2025-05-21)
  ('2025-04-01', 4.10, '2025-02-19', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q3 2025: 3.85% on 2025-07-01 (cut to 3.85% on 2025-05-21; next cut 2025-08-13)
  ('2025-07-01', 3.85, '2025-05-21', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP),
  -- Q4 2025: 3.60% on 2025-10-01 (cut to 3.60% on 2025-08-13)
  ('2025-10-01', 3.60, '2025-08-13', 'https://www.rba.gov.au/statistics/cash-rate/', CURRENT_TIMESTAMP)
ON CONFLICT(collection_date) DO NOTHING;
