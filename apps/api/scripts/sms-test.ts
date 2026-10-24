/**
 * Operator tool: sends one real test text with the same settings the server uses, and prints the
 * provider's actual answer. Use it when sign-up codes do not arrive: the server only logs a short
 * line, this shows exactly what Twilio or Brevo said.
 *
 *   npm run sms:test -w @nts/api -- +23276123456
 */
/* eslint-disable no-console -- this is an operator CLI; stdout/stderr is its interface */
import '../src/config/dotenv.js';
import { loadEnv } from '../src/config/env.js';
import { BrevoSms, TwilioSms, type SmsSender } from '../src/platform/sms.js';

const to = process.argv[2];
if (!to || !/^\+[1-9][0-9]{7,14}$/.test(to)) {
  console.error('Usage: sms:test <number in international form, e.g. +23276123456>');
  process.exit(2);
}
const env = loadEnv();

let sender: SmsSender;
let name: string;
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  name = 'Twilio';
  sender = new TwilioSms({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
  });
} else if (env.BREVO_API_KEY && env.BREVO_SMS_SENDER) {
  name = 'Brevo';
  sender = new BrevoSms({ apiKey: env.BREVO_API_KEY, sender: env.BREVO_SMS_SENDER });
} else {
  console.error(
    'No text-message provider is configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and ' +
      'TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID), or BREVO_API_KEY and BREVO_SMS_SENDER. ' +
      'ALLOW_DEV_SMS only writes codes to the log: it never sends anything.',
  );
  process.exit(1);
}

try {
  await sender.send(to, 'NTS Transport: this is a test message. No action is needed.');
  console.log(`${name} accepted the message. If it does not arrive, check ${name}'s delivery log.`);
} catch (err) {
  console.error(`${name} did not accept the message: ${(err as Error).message}`);
  process.exit(1);
}
