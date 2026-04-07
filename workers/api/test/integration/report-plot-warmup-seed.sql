INSERT INTO historical_savings_rates (
  bank_name, collection_date, product_id, product_name, series_key,
  account_type, rate_type, interest_rate, deposit_tier,
  source_url, data_quality_flag, confidence_score, retrieval_type,
  parsed_at, run_source
) VALUES (?, ?, ?, ?, ?, 'savings', 'base', ?, 'all', ?, 'cdr_live', 0.9, 'present_scrape_same_date', ?, 'scheduled')
