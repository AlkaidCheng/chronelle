ALTER TABLE events
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  ADD CONSTRAINT events_calendar_dates_valid CHECK (
    (starts_on IS NOT NULL OR ends_on IS NULL)
    AND (ends_on IS NULL OR ends_on >= starts_on)
    AND (starts_on IS NULL OR (starts_at IS NULL AND ends_at IS NULL))
    AND (starts_on IS NULL OR starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
    AND (ends_on IS NULL OR ends_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
  );

COMMENT ON COLUMN events.starts_on IS 'Calendar date without an implied time or timezone; mutually exclusive with instant fields.';
COMMENT ON COLUMN events.ends_on IS 'Inclusive final calendar date; null when no end date is specified.';
