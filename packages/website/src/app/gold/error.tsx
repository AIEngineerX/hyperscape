"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GoldError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Gold Page Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--bg-depth)] flex flex-col items-center justify-center container-padding">
      <div className="max-w-md text-center">
        <h1
          className="heading-section mb-4"
          style={{ color: "var(--gold-essence)" }}
        >
          Something went wrong
        </h1>
        <p
          role="alert"
          className="font-body text-base mb-8"
          style={{ color: "var(--text-secondary)" }}
        >
          {process.env.NODE_ENV === "development"
            ? error.message ||
              "Unable to load the $GOLD token page. Please try again."
            : "Unable to load the $GOLD token page. Please try again."}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            type="button"
            onClick={reset}
            className="btn-primary px-8 py-3 font-display"
          >
            Try again
          </button>
          <Link
            href="/"
            className="btn-secondary px-8 py-3 font-display inline-flex items-center justify-center"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
