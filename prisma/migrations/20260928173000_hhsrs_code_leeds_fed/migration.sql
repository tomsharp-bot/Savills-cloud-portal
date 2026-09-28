-- Live Leeds project is "Leeds Fed HA 2026". Names starting with "leeds fed"
-- get LFHA, same as the Reporter roster entry "LFHA (Leeds)".
-- Earlier named clients still win, so a name that also matches them is left alone.
UPDATE "Project"
SET "hhsrsCode" = 'LFHA'
WHERE lower(btrim("name")) LIKE 'leeds fed%'
  AND lower(btrim("name")) !~ 'saxon'
  AND lower(btrim("name")) !~ 'test[[:space:]]*housing'
  AND lower(btrim("name")) !~ 'cornwall'
  AND lower(btrim("name")) !~ 'onward'
  AND lower(btrim("name")) !~ 'vico'
  AND lower(btrim("name")) !~ 'bpha'
  AND lower(btrim("name")) !~ 'metropolitan'
  AND lower(btrim("name")) !~ 'mtvh'
  AND lower(btrim("name")) !~ '(a2d|a2[[:space:]]*dominion)'
  AND "hhsrsCode" <> 'LFHA';
