-- Production integrity probe (v2.5.0 deployment).
-- Emits, in a stable order: the migration ledger, the base-table count, a row count and an
-- order-independent full-row fingerprint for EVERY base table, and named anchors over the
-- records that matter most. Run verbatim before and after each step; the diff is the evidence.
--
-- The `mi_pre0030` / `pf_pre0031` anchors hash ONLY the columns that existed before the
-- migration under test, so a table whose row literal legitimately gains a new NULL column can
-- still be proven unmodified.
\pset tuples_only on
\pset format unaligned

SELECT '## LEDGER  ' || count(*) FROM drizzle.__drizzle_migrations;
SELECT '## TABLES  ' || count(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Per-table row counts
SELECT 'cnt ' || rpad(table_name, 34) || ' ' ||
       (xpath('/row/c/text()', q))[1]::text
FROM (
  SELECT table_name,
         query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '') AS q
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
) t
ORDER BY table_name;

-- Per-table order-independent full-row fingerprints
SELECT 'fp  ' || rpad(table_name, 34) || ' ' ||
       coalesce(nullif((xpath('/row/f/text()', q))[1]::text, ''), '<empty>')
FROM (
  SELECT table_name,
         query_to_xml(format(
           'select md5(coalesce(string_agg(x, E''\n'' order by x), '''')) as f '
           'from (select t::text as x from public.%I t) s', table_name), false, true, '') AS q
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
) t
ORDER BY table_name;

-- Named anchors
SELECT 'anchor d022_programs      ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (SELECT (id || '|' || name || '|' || coalesce(status, ''))::text AS x FROM programs) s;

SELECT 'anchor people_roster      ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (SELECT (id || '|' || full_name)::text AS x FROM people) s;

SELECT 'anchor committees         ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (SELECT (id || '|' || name_ar)::text AS x FROM committees) s;

SELECT 'anchor stored_files       ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (SELECT (id || '|' || coalesce(sha256, ''))::text AS x FROM stored_files) s;

SELECT 'anchor issued_documents   ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (SELECT (id || '|' || coalesce(doc_number, ''))::text AS x FROM documents) s;

-- Pre-0031 column subset of program_followups: proves 0031 altered no existing record.
SELECT 'anchor pf_pre0031         ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (
  SELECT (id || '|' || program_id || '|' || coalesce(week_key, '') || '|' ||
          coalesce(execution_status, '') || '|' || coalesce(note, '') || '|' ||
          coalesce(progress_snapshot::text, ''))::text AS x
  FROM program_followups
) s;

-- Carried forward from v2.4.1 so the v2.4.1 baseline anchor stays comparable.
SELECT 'anchor mi_pre0030         ' ||
       md5(coalesce(string_agg(x, E'\n' ORDER BY x), ''))
FROM (
  SELECT (id || '|' || coalesce(title, '') || '|' || coalesce(status, ''))::text AS x
  FROM maintenance_issues
) s;

SELECT 'anchor finance_sums       income=' || coalesce((SELECT sum(amount)::text FROM budget_income), '0')
       || ' expense=' || coalesce((SELECT sum(amount)::text FROM budget_expenses), '0');

SELECT 'anchor perms_v250         ' || count(*)
FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
WHERE p.key IN ('reports.builder', 'reports.templates.share', 'reports.templates.global');
