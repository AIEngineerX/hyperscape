"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "../icons";

const TOKEN_ADDRESS = "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump";

export function CopyAddress() {
  const [copied, setCopied] = useState(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(TOKEN_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-6">
      <p
        className="text-sm uppercase tracking-widest mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        Contract Address
      </p>
      <button
        type="button"
        className="inline-flex items-center gap-3 cursor-pointer group px-4 py-3 rounded-sm transition-colors"
        style={{
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(139, 105, 20, 0.15)",
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
          className="flex-shrink-0 p-1.5 rounded transition-all"
          style={{
            background: copied ? "rgba(212, 168, 75, 0.2)" : "transparent",
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
      </div>
    </div>
  );
}
