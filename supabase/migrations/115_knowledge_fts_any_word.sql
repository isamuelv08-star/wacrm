-- ============================================================
-- 115 — Knowledge-base lexical search: match ANY word, not ALL
-- ============================================================
--
-- `plainto_tsquery` ANDs every word of the customer's message, so a
-- real WhatsApp question ("hola cuanto cuestan las llantas 205 55 r16
-- para mi carro") only matched a chunk containing every single one of
-- those words — in practice nothing, and the bot answered without the
-- business's own price list / policies (or handed off).
--
-- Now: the message is split into words (3+ chars, minus common
-- Spanish/English filler), each used as a prefix (`llanta:*` also
-- matches "llantas"), OR-ed together, and ts_rank orders chunks by how
-- many of them they contain. Same signature, same SECURITY INVOKER
-- posture as migration 032, same stored `fts` column — no reindex.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH words AS (
    SELECT DISTINCT w
    FROM regexp_split_to_table(lower(coalesce(p_query, '')), '[^[:alnum:]]+') AS w
    WHERE length(w) >= 3
      AND w NOT IN (
        'que', 'los', 'las', 'del', 'para', 'por', 'con', 'una', 'uno', 'unos', 'unas',
        'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'gracias', 'favor',
        'como', 'esta', 'este', 'esto', 'eso', 'esa', 'ese', 'sus', 'mis', 'tus',
        'pero', 'más', 'mas', 'muy', 'hay', 'tiene', 'tienen', 'tengo', 'quiero',
        'quisiera', 'saber', 'info', 'información', 'informacion', 'porfa', 'ustedes',
        'the', 'and', 'for', 'you', 'what', 'how', 'with', 'hello', 'thanks', 'please'
      )
    LIMIT 24
  ),
  q AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                ELSE to_tsquery('simple', string_agg(w || ':*', ' | '))
           END AS tsq
    FROM words
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, q.tsq) AS rank
  FROM ai_knowledge_chunks c, q
  WHERE c.account_id = p_account_id
    AND q.tsq IS NOT NULL
    AND c.fts @@ q.tsq
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;
