-- Seed historical RBA cash rate decisions so the economic report charts have
-- full rate-cycle context. One row per decision date (collection_date = effective_date).
-- Source: RBA F1 statistical table (https://www.rba.gov.au/statistics/tables/csv/f1-data.csv)
-- ON CONFLICT DO NOTHING so live collection rows are never overwritten.

INSERT INTO rba_cash_rates (collection_date, cash_rate, effective_date, source_url, fetched_at) VALUES
    ('2020-11-04', 0.10, '2020-11-04', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-05-04', 0.35, '2022-05-04', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-06-08', 0.85, '2022-06-08', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-07-06', 1.35, '2022-07-06', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-08-03', 1.85, '2022-08-03', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-09-07', 2.35, '2022-09-07', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-10-05', 2.60, '2022-10-05', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-11-02', 2.85, '2022-11-02', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2022-12-07', 3.10, '2022-12-07', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2023-02-08', 3.35, '2023-02-08', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2023-03-08', 3.60, '2023-03-08', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2023-05-03', 3.85, '2023-05-03', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2023-06-07', 4.10, '2023-06-07', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2023-11-08', 4.35, '2023-11-08', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2025-02-19', 4.10, '2025-02-19', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2025-05-21', 3.85, '2025-05-21', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2025-08-13', 3.60, '2025-08-13', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP),
    ('2026-02-04', 3.85, '2026-02-04', 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv', CURRENT_TIMESTAMP)
ON CONFLICT(collection_date) DO NOTHING;
