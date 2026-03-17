-- Monthly export: export_kind 'full' | 'monthly'; when 'monthly', month_iso is YYYY-MM.
ALTER TABLE admin_download_jobs ADD COLUMN export_kind TEXT NOT NULL DEFAULT 'full' CHECK (export_kind IN ('full', 'monthly'));
ALTER TABLE admin_download_jobs ADD COLUMN month_iso TEXT;
