import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="mx-auto w-[90%] px-4 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-brand-700 font-medium">
        Back to home
      </Link>
    </main>
  );
}
