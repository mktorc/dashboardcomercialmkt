-- Add miscellaneous_price and additional_charges_price columns to reservations
ALTER TABLE "public"."reservations"
ADD COLUMN "miscellaneous_price" numeric DEFAULT 0,
ADD COLUMN "additional_charges_price" numeric DEFAULT 0;

-- Create indexes for performance
CREATE INDEX "idx_reservations_miscellaneous_price" ON "public"."reservations" ("miscellaneous_price");
CREATE INDEX "idx_reservations_additional_charges_price" ON "public"."reservations" ("additional_charges_price");
