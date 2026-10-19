-- Add miscellaneous_price and additional_charges_price columns to reservations
ALTER TABLE "public"."reservations"
ADD COLUMN IF NOT EXISTS "miscellaneous_price" numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS "additional_charges_price" numeric DEFAULT 0;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_reservations_miscellaneous_price" ON "public"."reservations" ("miscellaneous_price");
CREATE INDEX IF NOT EXISTS "idx_reservations_additional_charges_price" ON "public"."reservations" ("additional_charges_price");
