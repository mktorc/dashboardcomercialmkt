CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION public.seller_key(_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT CASE WHEN coalesce(trim(_name),'') = '' THEN NULL ELSE
    (SELECT CASE k WHEN 'naty' THEN 'nathalia' WHEN 'thay' THEN 'thayanne' ELSE k END
     FROM (SELECT split_part(lower(extensions.unaccent(normalize(trim(_name), NFC))), ' ', 1) AS k) s)
  END
$$;
GRANT EXECUTE ON FUNCTION public.seller_key(text) TO authenticated, service_role;