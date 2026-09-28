-- Leeds Federation is LFHA. Same match as the Reporter roster entry "LFHA (Leeds)":
-- the name starts with LFHA (Project Progress alias "LFHA 2026"), or it contains (Leeds).
-- Earlier named clients still win, so "Onward (Leeds)" stays ONW.
UPDATE "Project"
SET "hhsrsCode" = 'LFHA'
WHERE (
    lower(btrim("name")) LIKE 'lfha%'
    OR position('(leeds)' in lower("name")) > 0
  )
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
