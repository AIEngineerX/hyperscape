import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--bg-depth)] flex flex-col items-center justify-center container-padding">
      <div className="max-w-md text-center" role="status" aria-live="polite">
        <p
          className="label-upper mb-4"
          style={{ color: "var(--gold-essence)" }}
        >
          404
        </p>
        <h1
          className="heading-section mb-4"
          style={{ color: "var(--text-primary)" }}
        >
          Page not found
        </h1>
        <p
          className="font-body text-base mb-8"
          style={{ color: "var(--text-secondary)" }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="btn-primary px-8 py-3 font-display inline-flex items-center justify-center"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
