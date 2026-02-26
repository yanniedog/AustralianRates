-- Persist full CDR product-detail JSON payload per stored row so analyst views can expose
-- every field returned by CDR detail endpoints for that row.

ALTER TABLE historical_loan_rates
  ADD COLUMN cdr_product_detail_json TEXT;

ALTER TABLE historical_savings_rates
  ADD COLUMN cdr_product_detail_json TEXT;

ALTER TABLE historical_term_deposit_rates
  ADD COLUMN cdr_product_detail_json TEXT;
