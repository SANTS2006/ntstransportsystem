-- Phase 19b (cont.)
-- The subject is a phone number (E.164) for text codes and an e-mail address for e-mail codes.
ALTER TABLE "phone_otps" DROP CONSTRAINT "phone_otps_phone_chk";
ALTER TABLE "phone_otps" ADD CONSTRAINT "phone_otps_phone_chk" CHECK (
  ("purpose" = 'EMAIL_VERIFY' AND "phone" ~ '^[^[:space:]@]+@[^[:space:]@]+$')
  OR ("purpose" <> 'EMAIL_VERIFY' AND "phone" ~ '^\+[1-9][0-9]{7,14}$')
);
