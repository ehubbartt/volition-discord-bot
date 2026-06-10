-- Link a bot `events` row to a SITE `vs_events` row.
-- Mirrors the existing `vs_task_id` link (which connects a bot event to a
-- vs_tasks instance). Used by jobs/eventAnnouncePoller.js + handlers/eventAnnounce.js
-- to post ONE "currently running event" embed per site event into the events
-- channel (with a link back to the site to submit) and refresh/close it.
--
-- Apply by hand in the Supabase SQL editor (bot shares the site's project).

ALTER TABLE events ADD COLUMN IF NOT EXISTS vs_event_id uuid;
CREATE INDEX IF NOT EXISTS idx_events_vs_event_id ON events(vs_event_id);
