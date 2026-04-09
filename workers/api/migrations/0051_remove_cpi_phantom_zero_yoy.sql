-- Sparse early G1 rows had no GCPIAGYP value; the parser used to coerce that to 0% YoY.
-- Remove those phantom quarters (no ABS series value for year-ended change in source).

DELETE FROM cpi_data
WHERE quarter_date IN (
  '1922-04-01',
  '1922-07-01',
  '1922-10-01',
  '1923-01-01'
)
AND annual_change = 0;
