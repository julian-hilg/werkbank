/** Two versions of an invented config file: the sample the Text diff panel opens with. */

export const SAMPLE_NAME = "ingest.yaml";

export const SAMPLE_BEFORE = `# ingest.yaml (sample data, not a real service)
service: price-ingest
version: 1.4.0

schedule:
  cron: "15 6 * * 1-5"
  timezone: Europe/Berlin
  retries: 2

sources:
  - name: vendor-prices
    format: csv
    delimiter: ";"
  - name: filings
    format: json

checks:
  max_gap_days: 3
  allow_negative_prices: false
  row_count_tolerance: 0.05

output:
  table: prices_daily
  mode: append
  notify: data-team@example.com
`;

export const SAMPLE_AFTER = `# ingest.yaml (sample data, not a real service)
service: price-ingest
version: 1.5.0

schedule:
  cron: "45 5 * * 1-5"
  timezone: Europe/Berlin
  retries: 3
  retry_delay_seconds: 120

sources:
  - name: vendor-prices
    format: csv
  - name: filings
    format: json
  - name: trading-calendar
    format: csv

checks:
  max_gap_days: 3
  row_count_tolerance: 0.02

output:
  table: prices_daily
  mode: merge
  notify: data-team@example.com
`;
