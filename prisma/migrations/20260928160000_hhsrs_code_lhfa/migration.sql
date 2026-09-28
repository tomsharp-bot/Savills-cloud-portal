-- A project whose name contains LHFA uses the code LHFA, even when those
-- letters are not at the start. New and renamed projects are set in the app.
UPDATE "Project"
SET "hhsrsCode" = 'LHFA'
WHERE position('lhfa' in lower("name")) > 0
  AND "hhsrsCode" <> 'LHFA';
