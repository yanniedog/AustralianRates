-- Enforce numeric and date bounds on rate tables as a DB backstop.
-- Application validators remain the primary enforcement; these triggers reject
-- out-of-range values if any write path bypasses validation.

-- historical_loan_rates: interest_rate 0.5-25, comparison_rate 0.5-30 or null, annual_fee 0-10000 or null
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

-- historical_savings_rates: interest_rate 0-15, monthly_fee 0-50 or null, balances 0-100000000 or null
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

-- historical_term_deposit_rates: interest_rate 0-15, term_months 1-120, deposits 0-100000000 or null
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
