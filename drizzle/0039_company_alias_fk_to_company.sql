-- company_alias.company_key: foreign key moves from target_company to company.
--
-- Why: the canonical record an alias resolves to is usually a plain CRM company, not a hiring target, so
-- target_company was too narrow (scripts/merge-companies.ts could not write an alias to a non-target survivor).
-- company(company_key) is the primary key, so it admits every case and still stops an alias naming a company
-- that does not exist.
--
-- ON DELETE CASCADE: an alias to a company that no longer exists is meaningless, and a stale one could resurrect a
-- dead key on a later import. It cannot eat an alias that matters: scripts/merge-companies.ts repoints every alias
-- to the survivor before it deletes a dead company row (and proves no reference is left), and
-- scripts/clear-non-company-employers.ts refuses to delete a company that has any alias.
--
-- Dropping the old FK is done against the catalog row, not its name: migration 0003 created it inline, so
-- production's name (company_alias_company_key_fkey) differs from the one drizzle-kit assumes. Idempotent, and
-- tolerant of the new FK already existing. Adding the FK fails if an alias points at a missing company; the table
-- was empty when this was written.
DO $$ BEGIN
  EXECUTE coalesce((SELECT format('ALTER TABLE public.company_alias DROP CONSTRAINT %I', conname) FROM pg_constraint
    WHERE conrelid = 'public.company_alias'::regclass AND contype = 'f' AND confrelid = 'public.target_company'::regclass LIMIT 1), 'SELECT 1');
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.company_alias'::regclass AND contype = 'f' AND confrelid = 'public.company'::regclass) THEN
    ALTER TABLE public.company_alias ADD CONSTRAINT company_alias_company_key_company_company_key_fk
      FOREIGN KEY (company_key) REFERENCES public.company(company_key) ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
