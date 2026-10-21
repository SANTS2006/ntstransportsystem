import { Link } from 'react-router';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand-700">NTS Transport Platform</h1>
      <p className="mt-3 text-slate-600 dark:text-slate-300">
        Book bus seats online and pay with mobile money, or run your transport company: routes,
        fleet, crew, dispatch and ticketing in one place.
      </p>
      <Link
        to="/trips"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-5 font-medium text-white hover:bg-brand-600"
      >
        Find a trip
      </Link>
    </main>
  );
}
