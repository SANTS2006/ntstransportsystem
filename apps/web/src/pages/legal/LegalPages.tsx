import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeToggle } from '../../components/ui/ThemeToggle';

const UPDATED = '25 October 2026';

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-950">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/" aria-label="NTS Transport" className="flex items-center gap-2.5">
          <img src="/nts-wordmark.png" alt="" width={340} height={130} className="h-10 w-auto" />
          <span className="font-bold text-brand-900 dark:text-white">NTS Transport</span>
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
        <article className="space-y-6 rounded-3xl bg-white p-6 shadow-level3 sm:p-10 dark:bg-slate-900">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-brand-900 dark:text-white">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Last updated {UPDATED}
            </p>
          </div>
          {children}
          <nav
            aria-label="Legal"
            className="flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm font-semibold text-brand-600 dark:border-slate-800"
          >
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </article>
      </main>
    </div>
  );
}

const H = ({ children }: { children: ReactNode }) => (
  <h2 className="pt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{children}</h2>
);
const P = ({ children }: { children: ReactNode }) => (
  <p className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">{children}</p>
);
const L = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1.5 pl-6 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">
    {items.map((i, n) => (
      <li key={n}>{i}</li>
    ))}
  </ul>
);

export function TermsPage() {
  return (
    <Page title="Terms of Service">
      <P>
        These terms are the agreement between you and NTS Transport, the platform that lets licensed
        transport companies in Sierra Leone sell seats, issue tickets and manage their operations.
        By creating an account or using the service you accept them. If you do not accept them,
        please do not create an account.
      </P>

      <H>1. Who provides what</H>
      <P>
        NTS Transport provides the software: accounts, booking, payment collection, tickets and
        boarding. The journeys themselves are provided by the transport company whose page you use.
        When you book a seat, your contract for the journey is with that company, and the company is
        responsible for the vehicle, the timetable, delays and refunds under its own rules.
      </P>

      <H>2. Your account</H>
      <L
        items={[
          'You must give true details and keep them up to date.',
          'Keep your password private. You are responsible for what is done with your account. Turn on two-step verification under Security for extra protection.',
          'An account belongs to one person and to the company page it was created on. Do not share it or use it to pretend to be someone else.',
          'Tell us straight away if you think someone else has used your account.',
        ]}
      />

      <H>3. Booking and paying</H>
      <L
        items={[
          'Seats are held for a short time while you pay. If you do not pay in time the seats are released.',
          'Prices are shown in the company’s currency, usually Sierra Leonean leone (SLE). The price you see when you confirm is the price you pay.',
          'Payment is made by mobile money (Orange Money, AfriMoney or QMoney) or at the company’s desk. Online payments are processed by our payment provider; we do not see or store your wallet PIN.',
          'A booking is confirmed only when the company or the payment provider confirms the payment. Each seat then gets its own QR ticket.',
          'Cancellations and refunds follow the company’s own policy. Where a booking was paid and is cancelled, the company records the refund that is due to you.',
        ]}
      />

      <H>4. Tickets and travelling</H>
      <P>
        Show your ticket (QR code or ticket code) when you board. A ticket works once and is checked
        by the crew. Tickets that are copied, altered or resold may be cancelled without refund.
        Arrive in good time; a company may refuse boarding to someone who is late, unfit to travel
        or breaking its safety rules.
      </P>

      <H>5. Things you must not do</H>
      <L
        items={[
          'Use the service for anything unlawful, or to harass, threaten or cheat others.',
          'Try to break into the service, bypass its security, overload it, or collect other people’s information.',
          'Upload files that are unlawful, harmful, or that you have no right to share.',
          'Make bookings you do not mean to use in order to block seats.',
        ]}
      />

      <H>6. Complaints, jobs and files</H>
      <P>
        You can send a complaint (with photos, video or a voice message) to the company, rate a
        trip, and apply for jobs a company advertises, attaching a CV. What you send is visible to
        that company and to the platform team where needed to resolve a problem. Please send only
        what is needed and only things you are allowed to share.
      </P>

      <H>7. Availability</H>
      <P>
        We work to keep the service running, but it can be interrupted for maintenance, by faults of
        our providers (hosting, mobile money, text messages, e-mail) or by things outside our
        control. We may switch the service to maintenance mode with notice shown in the app.
      </P>

      <H>8. Our responsibility</H>
      <P>
        We are not responsible for the transport service itself, for delays, cancellations,
        accidents or lost property, which are matters between you and the company. To the extent the
        law allows, our liability to you for the software is limited to the amount you paid through
        the platform for the booking concerned. Nothing here limits rights you have under the law
        that cannot be limited.
      </P>

      <H>9. Suspending or closing accounts</H>
      <P>
        We or the company may suspend an account that breaks these terms or puts others at risk. You
        can stop using the service at any time and ask for your account to be closed (see the
        Privacy Policy for what happens to your information).
      </P>

      <H>10. Changes</H>
      <P>
        We may update these terms. The date at the top shows the latest version, and we will show a
        notice in the app when something important changes. Using the service after a change means
        you accept it.
      </P>

      <H>11. Law and contact</H>
      <P>
        These terms are governed by the laws of Sierra Leone. For questions about a journey, contact
        the transport company you booked with. For questions about the platform or your account,
        contact the NTS Transport team through your company’s page or its support contact.
      </P>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy Policy">
      <P>
        This policy explains what information NTS Transport collects, why, who sees it, and the
        choices you have. We collect only what the service needs to work, and we do not sell your
        information.
      </P>

      <H>1. Who is responsible</H>
      <P>
        NTS Transport runs the platform. Each transport company decides how it uses the booking,
        passenger and staff information of its own customers and employees, and is responsible for
        that use together with us. Your account is tied to the company page you signed up on.
      </P>

      <H>2. What we collect</H>
      <L
        items={[
          'Account details: your name, e-mail address and/or phone number, and a password (kept only as a one-way scrambled value, never in readable form). If you sign in with Google, we receive your name and e-mail address from Google.',
          'Security information: sign-in times and the device and browser used (to show your active sessions and spot misuse), two-step verification settings, and failed sign-in counts.',
          'Booking information: trips you book, passenger names and seat numbers, contact name and phone, payment status and references, tickets and whether they were used at boarding.',
          'Payment information: we record that a payment was made, its amount, method and reference. Mobile money is handled by the payment provider and the wallet operator; we never see your PIN.',
          'What you choose to send: complaints and replies with photos, video or voice messages, trip ratings, job applications and CVs, a profile picture.',
          'Staff information: for people who work for a company, their role, licence and document records the company enters.',
          'Records of actions in the system (an audit log) showing who did what and when, kept for security and accountability.',
        ]}
      />

      <H>3. Why we use it</H>
      <L
        items={[
          'To create and protect your account and to confirm your e-mail address or phone number with a code.',
          'To book seats, take payment, issue tickets, run boarding and handle refunds and complaints.',
          'To send you messages about your account and bookings (confirmations, delays, cancellations, refunds, codes) by e-mail, text message and in the app.',
          'To let companies run their business: reports, staff and vehicle records, hiring.',
          'To keep the service safe, investigate misuse and meet legal duties.',
        ]}
      />

      <H>4. Who sees it</H>
      <L
        items={[
          'The company you book with or work for sees the bookings, tickets, complaints and applications that concern it, and its own staff according to their roles.',
          'Platform staff can see company and account information and the audit log where needed to run and protect the service.',
          'Service providers that process data for us: hosting and database (including Neon), e-mail (Brevo), text messages (Twilio or Brevo), file storage (Cloudinary), payments (Monime), and Google for Google sign-in. They may only use it to provide their service to us.',
          'Authorities, when the law requires it.',
        ]}
      />
      <P>
        Other passengers and other companies cannot see your information. Companies are kept apart
        from each other in our database.
      </P>

      <H>5. Cookies and storage in your browser</H>
      <P>
        We use a small number of essential cookies: one that keeps you signed in, and one that
        protects your requests from forgery. We also remember your light or dark mode choice and the
        last company page you used in your browser’s storage. We do not use advertising or tracking
        cookies.
      </P>

      <H>6. How long we keep it</H>
      <P>
        We keep account and booking information while your account is open and for as long as needed
        afterwards for records, disputes, refunds, tax and legal reasons. Sign-in codes expire
        within minutes. Files such as CVs and complaint attachments are kept for as long as the
        company needs them for the purpose they were sent.
      </P>

      <H>7. Your choices and rights</H>
      <L
        items={[
          'See and correct your name and picture under Profile and settings.',
          'Change your password, turn on two-step verification and sign out other devices under Security.',
          'Ask for a copy of your information, for it to be corrected, or for your account to be closed and your personal information deleted or anonymised, by contacting the company you signed up with or the NTS Transport team. We may keep what the law or an unresolved dispute requires us to keep.',
          'Stop receiving optional messages. Messages about your account and bookings are part of the service.',
        ]}
      />

      <H>8. Keeping it safe</H>
      <P>
        Passwords are stored scrambled, connections are encrypted, each company’s data is separated
        in the database, access depends on role, and important actions are logged. No system is
        perfectly secure; tell us at once if you think your account was misused.
      </P>

      <H>9. Children</H>
      <P>
        The service is meant for adults. A parent or guardian may book for a child and enter the
        child’s name as a passenger. Please do not create an account for a child who cannot agree to
        these documents.
      </P>

      <H>10. Changes and contact</H>
      <P>
        We will update this policy when our practices change and show the date at the top. For
        privacy questions, contact the transport company you signed up with, or the NTS Transport
        team through your company’s page or its support contact.
      </P>
    </Page>
  );
}
