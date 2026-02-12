export function GoldDivider({ wide = false }: { wide?: boolean }) {
  return (
    <div
      className={`divider-gold ${wide ? "divider-gold-wide" : ""}`}
      aria-hidden="true"
    >
      <span className="w-1.5 h-1.5 rotate-45 bg-[var(--gold-dim)] shrink-0" />
    </div>
  );
}
