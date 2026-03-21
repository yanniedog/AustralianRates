-- CPI quarterly data table.
-- quarter_date = YYYY-MM-DD representing the start of the quarter
-- (Jan quarter = YYYY-01-01, Apr quarter = YYYY-04-01, Jul quarter = YYYY-07-01, Oct quarter = YYYY-10-01).
-- annual_change = All Groups CPI, annual % change (from ABS via RBA G1 table).
-- ON CONFLICT DO NOTHING so live ingest rows are never overwritten by re-running the seed.

CREATE TABLE IF NOT EXISTS cpi_data (
    quarter_date  TEXT PRIMARY KEY,
    annual_change REAL NOT NULL,
    source_url    TEXT NOT NULL,
    fetched_at    TEXT NOT NULL
);

-- Seed: ABS All Groups CPI annual % change from RBA G1 (published 29-Jan-2026).
-- Mar quarter → YYYY-01-01, Jun quarter → YYYY-04-01, Sep quarter → YYYY-07-01, Dec quarter → YYYY-10-01.
INSERT INTO cpi_data (quarter_date, annual_change, source_url, fetched_at) VALUES
    ('2021-01-01',  1.1, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2021-04-01',  3.8, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2021-07-01',  3.1, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2021-10-01',  3.5, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2022-01-01',  5.1, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2022-04-01',  6.2, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2022-07-01',  7.3, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2022-10-01',  7.9, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2023-01-01',  7.0, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2023-04-01',  6.0, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2023-07-01',  5.3, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2023-10-01',  4.1, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2024-01-01',  3.6, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2024-04-01',  3.8, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2024-07-01',  2.9, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2024-10-01',  2.4, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2025-01-01',  2.4, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2025-04-01',  2.1, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2025-07-01',  3.2, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP),
    ('2025-10-01',  3.6, 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv', CURRENT_TIMESTAMP)
ON CONFLICT(quarter_date) DO NOTHING;
