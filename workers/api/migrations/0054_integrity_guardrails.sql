-- Restore database-level integrity guardrails after historical dedupe migrations.
-- These triggers are defensive backstops for write paths that bypass app validators.

DROP TRIGGER IF EXISTS check_loan_rates_insert;
DROP TRIGGER IF EXISTS check_loan_rates_update;
DROP TRIGGER IF EXISTS check_savings_rates_insert;
DROP TRIGGER IF EXISTS check_savings_rates_update;
DROP TRIGGER IF EXISTS check_td_rates_insert;
DROP TRIGGER IF EXISTS check_td_rates_update;

DROP TRIGGER IF EXISTS check_loan_rates_series_key_insert;
DROP TRIGGER IF EXISTS check_loan_rates_series_key_update;
DROP TRIGGER IF EXISTS check_savings_rates_series_key_insert;
DROP TRIGGER IF EXISTS check_savings_rates_series_key_update;
DROP TRIGGER IF EXISTS check_td_rates_series_key_insert;
DROP TRIGGER IF EXISTS check_td_rates_series_key_update;

DROP TRIGGER IF EXISTS check_lender_dataset_runs_unchanged_nonnegative_insert;
DROP TRIGGER IF EXISTS check_lender_dataset_runs_unchanged_nonnegative_update;

-- historical_loan_rates: numeric/date bounds
CREATE TRIGGER IF NOT EXISTS check_loan_rates_insert
BEFORE INSERT ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0.5 OR NEW.interest_rate > 25;
  SELECT RAISE(ABORT, 'comparison_rate out of bounds')
  WHERE NEW.comparison_rate IS NOT NULL AND (NEW.comparison_rate < 0.5 OR NEW.comparison_rate > 30);
  SELECT RAISE(ABORT, 'annual_fee out of bounds')
  WHERE NEW.annual_fee IS NOT NULL AND (NEW.annual_fee < 0 OR NEW.annual_fee > 10000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

CREATE TRIGGER IF NOT EXISTS check_loan_rates_update
BEFORE UPDATE ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0.5 OR NEW.interest_rate > 25;
  SELECT RAISE(ABORT, 'comparison_rate out of bounds')
  WHERE NEW.comparison_rate IS NOT NULL AND (NEW.comparison_rate < 0.5 OR NEW.comparison_rate > 30);
  SELECT RAISE(ABORT, 'annual_fee out of bounds')
  WHERE NEW.annual_fee IS NOT NULL AND (NEW.annual_fee < 0 OR NEW.annual_fee > 10000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

-- historical_savings_rates: numeric/date bounds
CREATE TRIGGER IF NOT EXISTS check_savings_rates_insert
BEFORE INSERT ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'monthly_fee out of bounds')
  WHERE NEW.monthly_fee IS NOT NULL AND (NEW.monthly_fee < 0 OR NEW.monthly_fee > 50);
  SELECT RAISE(ABORT, 'min_balance out of bounds')
  WHERE NEW.min_balance IS NOT NULL AND (NEW.min_balance < 0 OR NEW.min_balance > 100000000);
  SELECT RAISE(ABORT, 'max_balance out of bounds')
  WHERE NEW.max_balance IS NOT NULL AND (NEW.max_balance < 0 OR NEW.max_balance > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

CREATE TRIGGER IF NOT EXISTS check_savings_rates_update
BEFORE UPDATE ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'monthly_fee out of bounds')
  WHERE NEW.monthly_fee IS NOT NULL AND (NEW.monthly_fee < 0 OR NEW.monthly_fee > 50);
  SELECT RAISE(ABORT, 'min_balance out of bounds')
  WHERE NEW.min_balance IS NOT NULL AND (NEW.min_balance < 0 OR NEW.min_balance > 100000000);
  SELECT RAISE(ABORT, 'max_balance out of bounds')
  WHERE NEW.max_balance IS NOT NULL AND (NEW.max_balance < 0 OR NEW.max_balance > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

-- historical_term_deposit_rates: numeric/date bounds
CREATE TRIGGER IF NOT EXISTS check_td_rates_insert
BEFORE INSERT ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'term_months out of bounds')
  WHERE NEW.term_months < 1 OR NEW.term_months > 120;
  SELECT RAISE(ABORT, 'min_deposit out of bounds')
  WHERE NEW.min_deposit IS NOT NULL AND (NEW.min_deposit < 0 OR NEW.min_deposit > 100000000);
  SELECT RAISE(ABORT, 'max_deposit out of bounds')
  WHERE NEW.max_deposit IS NOT NULL AND (NEW.max_deposit < 0 OR NEW.max_deposit > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

CREATE TRIGGER IF NOT EXISTS check_td_rates_update
BEFORE UPDATE ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'interest_rate out of bounds')
  WHERE NEW.interest_rate < 0 OR NEW.interest_rate > 15;
  SELECT RAISE(ABORT, 'term_months out of bounds')
  WHERE NEW.term_months < 1 OR NEW.term_months > 120;
  SELECT RAISE(ABORT, 'min_deposit out of bounds')
  WHERE NEW.min_deposit IS NOT NULL AND (NEW.min_deposit < 0 OR NEW.min_deposit > 100000000);
  SELECT RAISE(ABORT, 'max_deposit out of bounds')
  WHERE NEW.max_deposit IS NOT NULL AND (NEW.max_deposit < 0 OR NEW.max_deposit > 100000000);
  SELECT RAISE(ABORT, 'collection_date invalid')
  WHERE NEW.collection_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
END;

-- Canonical series_key parity guardrails.
CREATE TRIGGER IF NOT EXISTS check_loan_rates_series_key_insert
BEFORE INSERT ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || NEW.security_purpose || '|' ||
    NEW.repayment_type || '|' || NEW.lvr_tier || '|' || NEW.rate_structure
  );
END;

CREATE TRIGGER IF NOT EXISTS check_loan_rates_series_key_update
BEFORE UPDATE ON historical_loan_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || NEW.security_purpose || '|' ||
    NEW.repayment_type || '|' || NEW.lvr_tier || '|' || NEW.rate_structure
  );
END;

CREATE TRIGGER IF NOT EXISTS check_savings_rates_series_key_insert
BEFORE INSERT ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || NEW.account_type || '|' ||
    NEW.rate_type || '|' || NEW.deposit_tier
  );
END;

CREATE TRIGGER IF NOT EXISTS check_savings_rates_series_key_update
BEFORE UPDATE ON historical_savings_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || NEW.account_type || '|' ||
    NEW.rate_type || '|' || NEW.deposit_tier
  );
END;

CREATE TRIGGER IF NOT EXISTS check_td_rates_series_key_insert
BEFORE INSERT ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || CAST(NEW.term_months AS TEXT) || '|' ||
    NEW.deposit_tier || '|' || NEW.interest_payment
  );
END;

CREATE TRIGGER IF NOT EXISTS check_td_rates_series_key_update
BEFORE UPDATE ON historical_term_deposit_rates
BEGIN
  SELECT RAISE(ABORT, 'series_key missing')
  WHERE NEW.series_key IS NULL OR TRIM(NEW.series_key) = '';
  SELECT RAISE(ABORT, 'series_key mismatch')
  WHERE NEW.series_key != (
    NEW.bank_name || '|' || NEW.product_id || '|' || CAST(NEW.term_months AS TEXT) || '|' ||
    NEW.deposit_tier || '|' || NEW.interest_payment
  );
END;

-- lender_dataset_runs invariants: unchanged rows cannot be negative.
CREATE TRIGGER IF NOT EXISTS check_lender_dataset_runs_unchanged_nonnegative_insert
BEFORE INSERT ON lender_dataset_runs
BEGIN
  SELECT RAISE(ABORT, 'unchanged_row_count out of bounds')
  WHERE NEW.unchanged_row_count < 0;
END;

CREATE TRIGGER IF NOT EXISTS check_lender_dataset_runs_unchanged_nonnegative_update
BEFORE UPDATE ON lender_dataset_runs
BEGIN
  SELECT RAISE(ABORT, 'unchanged_row_count out of bounds')
  WHERE NEW.unchanged_row_count < 0;
END;
