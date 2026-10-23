-- Phase 19b: e-mail addresses are confirmed with a short code, like phone numbers. The "phone"
-- column of phone_otps holds whatever the code was sent to (a phone number or an e-mail address).
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFY';
