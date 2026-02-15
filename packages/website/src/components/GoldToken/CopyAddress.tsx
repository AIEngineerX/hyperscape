"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "../icons";
import { TOKEN_ADDRESS } from "@/lib/constants";

export function CopyAddress() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyToClipboard() {
    setError(null);
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Please select and copy manually.");
    }
  }

  return (
    <div className="mb-6">
      <p className="label-upper mb-2" style={{ color: "var(--text-muted)" }}>
        Contract Address
      </p>
      <button
        type="button"
        className="inline-flex items-center gap-3 cursor-pointer group px-4 py-3 rounded-lg transition-[border-color,background-color] hover:border-[var(--gold-border-strong)] hover:bg-[var(--bg-panel)]"
        style={{
          background: "rgba(26, 29, 36, 0.9)",
          border: "1px solid rgba(90, 95, 105, 0.3)",
        }}
        onClick={copyToClipboard}
        aria-label={
          copied
            ? "Address copied to clipboard"
            : "Copy contract address to clipboard"
        }
      >
        <code
          className="font-mono text-sm sm:text-base break-all transition-colors group-hover:opacity-80"
          style={{ color: "var(--gold-dim)" }}
        >
          {TOKEN_ADDRESS}
        </code>
        <span
          className="flex-shrink-0 p-1.5 rounded transition-[background,color]"
          style={{
            background: copied ? "var(--gold-bg-copied)" : "transparent",
            color: copied ? "var(--gold-essence)" : "var(--text-muted)",
          }}
          aria-hidden="true"
        >
          {copied ? (
            <CheckIcon className="w-5 h-5" />
          ) : (
            <CopyIcon className="w-5 h-5" />
          )}
        </span>
      </button>
      <div aria-live="polite" className="h-6">
        {copied && (
          <p className="text-sm mt-1" style={{ color: "var(--gold-essence)" }}>
            Copied to clipboard!
          </p>
        )}
        {error && (
          <p
            className="text-sm mt-1"
            style={{ color: "var(--gold-essence)" }}
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
