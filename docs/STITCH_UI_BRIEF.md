# UI design brief for Google Stitch: NTS Transport

Paste **Part 1** first (it sets the product and the visual system), then paste one **screen prompt**
from Part 2 at a time. Stitch works best with one screen or flow per prompt, and with the design
system restated briefly each time (a one-line "Use the NTS Transport design system above" is enough
inside a single project).

---

## Part 1: Product and design system (paste first)

**Design a modern, professional, trustworthy web application called "NTS Transport".**

### What it is

A multi-company transport platform for West Africa (first market: Sierra Leone, currency SLE,
mobile-money payments). Three kinds of people use it:

1. **Passengers** (the public): search coach/bus trips, pick seats, pay with mobile money, get
   tickets with QR codes, rate trips, file complaints, apply for jobs.
2. **Company staff** (each transport company is a separate tenant): owners, managers, dispatchers,
   ticket-desk agents, boarding staff, HR, finance. They manage routes, vehicles, trips, bookings,
   boarding, complaints, reports and recruitment.
3. **Platform operators** (the NTS team): approve companies, see platform-wide figures, switch
   maintenance mode.

Many passengers are on **mid-range Android phones over slow, expensive data**, in bright sunlight.
Staff use laptops at a desk and phones at the bus park. Design **mobile-first**, then scale up.

### Personality and tone

Calm, clear, reliable, like a good bank app crossed with a modern travel app. Not playful, not
corporate-grey. Friendly plain language ("Your seats are held for 15 minutes"). No jargon, no
exclamation marks, no stock-photo clutter. Money and time are always unambiguous.

### Visual system

- **Brand colour (teal):** 50 `#f0fdfa`, 500 `#14b8a6`, 600 `#0d9488`, **700 `#0f766e` (primary
  buttons, links, active nav)**. Text ink `#0f172a`.
- **Neutrals:** Tailwind slate scale. Page background `#f8fafc` (light) and `#0b1220` (dark); cards
  white / `#0f172a` with a 1 px slate-200 / slate-700 border and a very soft shadow.
- **Status colours** (always paired with an icon or label, never colour alone): green = confirmed /
  paid / active, amber = pending / held / awaiting, red = cancelled / failed / needs action, slate =
  closed / neutral.
- **Typography:** **Poppins** only. 400 body, 500 labels, 600 headings and buttons, 700 for big
  numbers. Body 15-16 px, minimum tap target 44 px, generous line height.
- **Shape and spacing:** 12 px radius on cards, 8 px on inputs and buttons, 8-pt spacing grid,
  content max width 1024 px on marketing pages, fluid on dashboards.
- **Dark mode:** full support, following the device setting. Keep contrast WCAG AA or better in both.
- **Icons:** a single simple outline set (1.8 px stroke, rounded). Small, consistent.
- **Motion:** minimal. Skeleton/spinner for loading, 150 ms fades. Respect reduced motion.
- **Accessibility:** visible focus ring (2 px teal), labels above inputs, errors linked to fields,
  keyboard-friendly, screen-reader labels on icon buttons, never information by colour alone.
- **Layouts:** public pages use a top bar (logo "N" mark + "NTS Transport", links: Find a trip,
  Jobs, Sign in, Create account). Signed-in areas use a **left sidebar** on desktop that collapses to
  a top bar plus horizontal scrolling nav on mobile, with a **notification bell** (unread badge)
  next to the logo and the user's name, email and "Sign out" at the bottom.
- **Global elements:** an amber **maintenance banner** across the top when the platform is in
  maintenance; toasts for success/error; empty states with one clear next action; inline error
  alerts with a "Try again" button.

### Content rules

- Currency always shows its code, e.g. "SLE 150.00". Dates are readable ("Fri 24 Oct, 08:00") and
  show the trip's local time zone when it matters.
- Seats are labelled like "1", "2", "12A". Booking references are 10 characters, upper case.
- Never show internal ids. Buttons say what they do ("Pay with mobile money", "Open boarding list").

---

## Part 2: Screen prompts (paste one at a time)

### A. Public home page

Landing page for NTS Transport. Hero with a clear headline ("Book your seat. Travel with confidence.")
and a **trip search card** (From, To, Date, "Search trips" button) that is the visual focus. Below:
three short value points (Pay with mobile money, Tickets on your phone, Trusted companies), a
"Popular routes" row of route cards (origin to destination, "from SLE 150.00"), a band for transport
companies ("Run a transport company? Register it on NTS"), and a footer. Mobile: search card
stacked, large inputs.

### B. Trip search results

Results for "Freetown to Bo, Fri 24 Oct". Filter bar (date arrows for previous/next day, service
class). Each result is a card: company name, departure and arrival time, duration, vehicle type
and service class badge, **seats left** (turn amber when under 5), price per seat, and a primary
"Choose seats" button. Empty state: "No trips on this date" with buttons to try the next or previous
day. Loading skeletons.

### C. Seat selection and booking

Trip summary header (route, times, company, price). A **bus seat map** (rows of seats with an aisle,
driver at the front) with legend: available, selected, taken. Selecting seats adds passenger rows
(full name per seat), contact name, phone (+232 hint) and optional email. A sticky summary bar at
the bottom on mobile: "2 seats, SLE 300.00" and a "Continue" button. Show a note: "Seats are held
for 15 minutes while you pay". Sign-in required step handled gracefully.

### D. Payment and confirmation

After booking: a **countdown card** ("Held for 14:32") with the booking summary and a prominent
"Pay with mobile money" button that opens the provider's hosted page. A return screen with three
states: **Checking payment** (spinner), **Confirmed** (green check, "Your tickets are ready",
buttons "View tickets" and "Download receipt"), **Payment not completed** (amber, "Try again").

### E. My bookings and tickets

"My bookings" list: cards with route, date, status badge (Held, Confirmed, Cancelled, Expired,
Trip finished), reference, seats, and total. Booking detail ("My tickets"): one **ticket card per
seat** with a large **QR code**, passenger name, seat, route, departure, short code under the QR,
and status ("Ready to use", "Boarded", "Cancelled"). Actions: Download tickets (PDF), Download
receipt, Cancel booking, **Rate this trip** (5 stars + comment, shown after the trip), **Report a
problem**. Make tickets feel like a boarding pass, high contrast so QR scans in sunlight.

### F. Complaints (passenger)

List of the passenger's complaints with status chips (Open, In review, Resolved, Closed). New
complaint form: choose booking, category, subject, description, attach up to 3 files (PDF/PNG/JPEG,
5 MB each). Thread view: chat-like timeline between the passenger and the company, attachments as
file chips, reply box.

### G. Sign in, register, security

Centered auth cards: Sign in (email, password, "Forgot password?", **Continue with Google**),
two-step **MFA code** screen (6 digit input), Create account, Verify email, Reset password. A
Security page: change password, set up two-factor (QR code to scan, manual key, recovery codes shown
once with a "copy" button), list of active sessions with "Sign out" per device.

### H. Jobs (public) and applications

Job board with filters (company, location, type) and cards (title, company, location, closing
date). Job detail with description and a prominent **Apply** panel (cover note, upload CV as PDF).
"My job applications" list with a **progress tracker** (Received, Shortlisted, Interview, Offered,
Hired / Not selected).

### I. Company dashboard shell and overview

The company workspace at `/c/<company>`. Left sidebar groups: **Operations** (Dispatch, Calendar,
Trips, Boarding), **Network** (Routes, Locations, Vehicles, Seat layouts), **Sales** (Bookings,
Payments), **People** (Team, Roles, Staff, Recruitment), **Insight** (Reports, Complaints,
Activity), **Maintenance**. Overview page: today's trips as a timeline, a row of KPI tiles (Revenue,
Seats sold, Occupancy, Open complaints), and an "Needs attention" list (payments for released seats
that need a refund, delayed trips, applications to review).

### J. Dispatch and trips

Dispatch board for today: trips as rows or cards grouped by status (Scheduled, Boarding, On the
road, Completed, Cancelled) with route, departure, vehicle, driver, seats sold/capacity as a thin
progress bar, and quick actions (Delay, Replace vehicle, Cancel, Assign crew). Trip detail with a
**timeline of events** (delay, vehicle change, cancellation with reasons) and the seat map showing
who sits where. A monthly **calendar** view of scheduled trips with blackout dates.

### K. Bookings desk (staff)

Searchable, filterable table of bookings (reference, passenger, trip, status, amount, created) with
a slide-over detail panel: passengers and seats, payment status, status history, actions (Mark
paid in cash, Cancel with reason). A "New booking" counter-sale flow: pick trip, pick seats,
passenger details, take payment.

### L. Boarding (phone-first)

A large, simple screen for staff at the bus door: trip picker, a big **input for scanning or typing
the ticket code** (camera scan is a future feature), then a full-screen result: green "Welcome
aboard: Fanta Jalloh, seat 5" or red/amber reasons ("Already used", "Wrong trip", "Not yet open",
"Cancelled"). Below: manifest with "12 of 40 boarded" progress and the list of passengers with
boarded ticks. Big buttons, high contrast, works one-handed.

### M. Reports

Date range picker, KPI tiles (Revenue, Bookings, Seats sold, Occupancy, Average rating, Refunds
owed), a revenue-by-day **bar chart** and a by-route table, an occupancy table per trip with
progress bars, and **Download CSV** buttons. Use the teal brand colour for the main series and keep
charts legible with labelled axes and a table fallback.

### N. Complaints, recruitment and team (staff)

Complaints inbox: list + thread side by side on desktop (status, category, booking reference,
messages, attachments, reply, resolve/close). Recruitment: job postings list (Draft, Open, Closed),
a posting editor, and an applicant **kanban or pipeline table** (Received to Hired) with a detail
panel (applicant info, CV preview/open button, internal notes marked "Private to HR", status
actions). Team page: members table with role chips, invite by email, role editor with permission
checkboxes grouped by area.

### O. Payment settings and company registration

Payment settings: a clear step-by-step card to connect the company's Monime account (Space ID, API
token, webhook secret shown once, the webhook URL with a copy button, a "Test connection" status).
Company registration form for new companies (name, time zone, currency, contact) with a "Pending
approval" waiting state.

### P. Platform admin

Platform overview: tiles (Active companies, Awaiting approval, Users, Open complaints, Notification
backlog with a red "failed" warning), confirmed sales table per currency, "Biggest companies" list.
Companies table with status chips and row actions (Approve, Reject, Suspend, Reactivate, Deactivate)
that open a confirmation dialog requiring a reason. Maintenance page: a big toggle, message box and
"Turn maintenance on/off" with a clear warning that the site will show 503 to the public.

### Q. Notifications panel and system states

The bell dropdown (320 px wide): list of notifications with unread dot, bold title, one-line body,
timestamp; "Mark all read". Also design the **empty, loading, error, 404 and maintenance** states
used across the app, and a confirmation dialog pattern for destructive actions.

---

## Part 3: What to ask Stitch for

- Produce **both light and dark** variants, and **mobile (375 px) and desktop (1280 px)** frames for
  each screen above.
- Keep one consistent component set: buttons (primary, secondary, ghost, danger), inputs, selects,
  date pickers, tables, cards, badges, tabs, dialogs, toasts, tiles, stepper, seat map.
- Export-friendly structure: Tailwind-style utility naming, the colour tokens above, Poppins.
