-- Review live table columns before running. Safe when coupons.value already exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coupons' AND column_name='discount_value')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coupons' AND column_name='value') THEN
    ALTER TABLE public.coupons RENAME COLUMN discount_value TO value;
  END IF;
END $$;
