import Image from "next/image";
import { Button } from "../ui/Button";
import { GitHubIcon, ExternalIcon, StarIcon } from "../icons";
import { CopyAddress } from "./CopyAddress";
import { GoldFadeIn } from "./GoldTokenAnimations";

const TOKEN_ADDRESS = "DK9nBUMfdu4XprPRWeh8f6KnQiGWD8Z4xz3yzs9gpump";
const PUMP_FUN_URL = `https://pump.fun/coin/${TOKEN_ADDRESS}`;
const SOLSCAN_URL = `https://solscan.io/token/${TOKEN_ADDRESS}`;
const GITHUB_URL = "https://github.com/HyperscapeAI/hyperscape";

function OrnateDivider() {
  return (
    <div
      className="flex items-center justify-center gap-3 py-2"
      aria-hidden="true"
    >
      <div
        className="h-px flex-1 max-w-16"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(139, 105, 20, 0.4) 100%)",
        }}
      />
      <StarIcon className="w-3.5 h-3.5" style={{ color: "var(--gold-dim)" }} />
      <div
        className="h-px flex-1 max-w-16"
        style={{
          background:
            "linear-gradient(90deg, rgba(139, 105, 20, 0.4) 0%, transparent 100%)",
        }}
      />
    </div>
  );
}

function TokenDetails() {
  const stats = [
    { label: "Supply", value: "1B" },
    { label: "Network", value: "Solana" },
    { label: "Type", value: "SPL" },
    { label: "Launch", value: "Pump.Fun" },
  ];

  return (
    <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
      <div className="flex-1 text-center md:text-left order-2 md:order-1">
        <GoldFadeIn onScroll={false} delay={0.1}>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl mb-2">
            <span className="text-gradient-gold">$GOLD</span>{" "}
            <span style={{ color: "var(--text-primary)" }}>Token</span>
          </h1>
        </GoldFadeIn>

        <GoldFadeIn onScroll={false} delay={0.15}>
          <p
            className="font-body text-sm sm:text-base md:text-lg max-w-lg mx-auto md:mx-0 mb-5"
            style={{ color: "var(--text-secondary)" }}
          >
            The official in-game currency of Hyperscape, tokenized on Solana.
            Every token equals exactly 1 gold in-game.
          </p>
        </GoldFadeIn>

        <GoldFadeIn onScroll={false} delay={0.2}>
          <div
            className="flex flex-wrap justify-center md:justify-start gap-6 sm:gap-8 py-4 mb-4"
            style={{
              borderTop: "1px solid rgba(139, 105, 20, 0.2)",
              borderBottom: "1px solid rgba(139, 105, 20, 0.2)",
            }}
          >
            {stats.map((stat) => (
              <div key={stat.label}>
                <p
                  className="text-xs uppercase tracking-widest mb-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {stat.label}
                </p>
                <p
                  className="font-display text-lg sm:text-xl md:text-2xl"
                  style={{ color: "var(--text-primary)" }}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </GoldFadeIn>

        <GoldFadeIn onScroll={false} delay={0.25}>
          <CopyAddress />
        </GoldFadeIn>

        <GoldFadeIn onScroll={false} delay={0.3}>
          <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
            <a
              href={PUMP_FUN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-display"
            >
              Buy $GOLD
              <ExternalIcon className="w-4 h-4" />
            </a>
            <a
              href={SOLSCAN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-display"
            >
              View on Solscan
              <ExternalIcon className="w-4 h-4" />
            </a>
          </div>
        </GoldFadeIn>
      </div>

      <GoldFadeIn
        className="flex-shrink-0 order-1 md:order-2"
        onScroll={false}
        delay={0}
        direction="none"
      >
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: "rgba(20, 18, 14, 0.6)",
            border: "1px solid rgba(139, 105, 20, 0.25)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div className="relative w-36 h-36 sm:w-44 sm:h-44 md:w-52 md:h-52 lg:w-60 lg:h-60">
            <Image
              src="/images/token.png"
              alt="$GOLD Token"
              fill
              className="object-contain"
              priority
              sizes="(max-width: 640px) 144px, (max-width: 768px) 176px, (max-width: 1024px) 208px, 240px"
            />
          </div>
        </div>
      </GoldFadeIn>
    </div>
  );
}

const howItWorks = [
  {
    num: "1",
    title: "Buy $GOLD",
    desc: "Purchase tokens on Pump.Fun using Solana",
  },
  {
    num: "2",
    title: "Hold Tokens",
    desc: "Your wallet balance determines your in-game wealth",
  },
  {
    num: "3",
    title: "Play Rich",
    desc: "Launch with gold and exclusive holder items",
  },
];

const platforms = ["Web", "iOS", "Android", "Windows", "Mac", "Linux"];

export function GoldToken() {
  return (
    <div className="relative overflow-hidden">
      {/* Scroll underlay */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none flex justify-center"
        style={{ opacity: 0.2 }}
        aria-hidden="true"
      >
        <Image
          src="/images/scroll.png"
          alt=""
          width={1000}
          height={3000}
          className="w-auto h-full max-w-none"
          style={{ objectFit: "fill" }}
          loading="lazy"
        />
      </div>

      {/* Hero Section */}
      <section className="relative z-[2] pt-24 pb-10 md:pt-28 md:pb-12">
        <div
          className="absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
          style={{
            maskImage:
              "linear-gradient(to bottom, black 0%, black 65%, rgba(0,0,0,0.3) 85%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 0%, black 65%, rgba(0,0,0,0.3) 85%, transparent 100%)",
          }}
        >
          <Image
            src="/images/gold-banner.png"
            alt=""
            fill
            className="object-cover scale-[1.2] md:scale-[1.1] object-center"
            quality={90}
            priority
            sizes="100vw"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(10,10,12,0.9) 0%, rgba(10,10,12,0.6) 50%, rgba(10,10,12,0.9) 100%)",
            }}
          />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto container-padding">
          <TokenDetails />
        </div>
      </section>

      {/* Features Header */}
      <section className="relative z-[2] pt-12 md:pt-16 pb-4">
        <div className="max-w-3xl mx-auto container-padding text-center">
          <GoldFadeIn>
            <h2
              className="font-display text-2xl sm:text-3xl md:text-4xl"
              style={{ color: "var(--text-primary)" }}
            >
              Features
            </h2>
          </GoldFadeIn>
          <OrnateDivider />
        </div>
      </section>

      {/* Value Props */}
      <section className="relative z-[2] py-4 md:py-8">
        <div className="max-w-3xl mx-auto container-padding space-y-5">
          {/* 1:1 Value */}
          <GoldFadeIn direction="left">
            <div className="flex items-center gap-5 sm:gap-6">
              <div className="flex-shrink-0 w-16 sm:w-24 text-center">
                <span className="font-display text-4xl sm:text-5xl md:text-6xl text-gradient-gold">
                  1:1
                </span>
              </div>
              <div className="flex-1">
                <h3
                  className="font-display text-lg sm:text-xl md:text-2xl mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  In-Game Value
                </h3>
                <p
                  className="font-body text-sm sm:text-base"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Every $GOLD token equals exactly 1 gold in Hyperscape. Your
                  wallet balance becomes your starting wealth.
                </p>
              </div>
            </div>
          </GoldFadeIn>

          <OrnateDivider />

          {/* Exclusive Items */}
          <GoldFadeIn direction="left" delay={0.1}>
            <div className="flex items-center gap-5 sm:gap-6">
              <div className="flex-shrink-0 w-16 sm:w-24 flex justify-center">
                <svg
                  className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: "var(--gold-essence)" }}
                  aria-hidden="true"
                >
                  <path
                    d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3
                    className="font-display text-lg sm:text-xl md:text-2xl"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Exclusive Items
                  </h3>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-display"
                    style={{
                      background: "rgba(212, 168, 75, 0.15)",
                      color: "var(--gold-essence)",
                    }}
                  >
                    Holders Only
                  </span>
                </div>
                <p
                  className="font-body text-sm sm:text-base"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Limited-edition gear and cosmetics available only to $GOLD
                  holders. Stand out from day one.
                </p>
              </div>
            </div>
          </GoldFadeIn>

          <OrnateDivider />

          {/* Cross-Platform */}
          <GoldFadeIn direction="left" delay={0.2}>
            <div className="flex items-center gap-5 sm:gap-6">
              <div className="flex-shrink-0 w-16 sm:w-24 flex justify-center gap-1.5">
                <svg
                  className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--gold-essence)" }}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <svg
                  className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--gold-essence)" }}
                  aria-hidden="true"
                >
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
                <svg
                  className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--gold-essence)" }}
                  aria-hidden="true"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </div>
              <div className="flex-1">
                <h3
                  className="font-display text-lg sm:text-xl md:text-2xl mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Play Anywhere
                </h3>
                <p
                  className="font-body text-sm sm:text-base mb-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Hyperscape runs on Browser, iOS, Android, and Desktop. Your
                  gold follows you everywhere.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {platforms.map((p) => (
                    <span
                      key={p}
                      className="px-2.5 py-0.5 rounded text-xs font-display"
                      style={{
                        background: "rgba(139, 105, 20, 0.1)",
                        color: "var(--text-secondary)",
                        border: "1px solid rgba(139, 105, 20, 0.2)",
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </GoldFadeIn>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative z-[2] py-10 md:py-14">
        <div className="max-w-4xl mx-auto container-padding">
          <GoldFadeIn className="text-center mb-8">
            <h2
              className="font-display text-2xl sm:text-3xl md:text-4xl"
              style={{ color: "var(--text-primary)" }}
            >
              How It Works
            </h2>
          </GoldFadeIn>

          {/* Desktop: horizontal with arrows */}
          <div className="hidden md:flex items-start justify-center">
            {howItWorks.map((item, i) => (
              <div key={item.num} className="flex items-start">
                <GoldFadeIn delay={i * 0.1}>
                  <div className="flex flex-col items-center text-center w-44 lg:w-48">
                    <div
                      className="w-14 h-14 lg:w-16 lg:h-16 rounded-full flex items-center justify-center font-display text-2xl lg:text-3xl mb-2"
                      style={{
                        background: "rgba(139, 105, 20, 0.15)",
                        border: "2px solid rgba(139, 105, 20, 0.4)",
                        color: "var(--gold-essence)",
                      }}
                    >
                      {item.num}
                    </div>
                    <h3
                      className="font-display text-lg lg:text-xl mb-1"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {item.title}
                    </h3>
                    <p
                      className="font-body text-sm lg:text-base"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {item.desc}
                    </p>
                  </div>
                </GoldFadeIn>

                {i < howItWorks.length - 1 && (
                  <div
                    className="flex items-center px-3 lg:px-5 pt-4"
                    aria-hidden="true"
                  >
                    <svg
                      className="w-8 h-8 lg:w-10 lg:h-10"
                      viewBox="0 0 24 24"
                      fill="none"
                      style={{ color: "var(--gold-dim)" }}
                    >
                      <path
                        d="M5 12h14M13 6l6 6-6 6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mobile: vertical layout */}
          <div className="flex flex-col gap-5 md:hidden">
            {howItWorks.map((item, i) => (
              <GoldFadeIn key={item.num} delay={i * 0.1}>
                <div className="flex items-start gap-4">
                  <div
                    className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-display text-xl"
                    style={{
                      background: "rgba(139, 105, 20, 0.15)",
                      border: "2px solid rgba(139, 105, 20, 0.4)",
                      color: "var(--gold-essence)",
                    }}
                  >
                    {item.num}
                  </div>
                  <div className="flex-1 pt-1">
                    <h3
                      className="font-display text-lg mb-0.5"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {item.title}
                    </h3>
                    <p
                      className="font-body text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {item.desc}
                    </p>
                  </div>
                </div>
              </GoldFadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Open Source */}
      <section className="relative z-[2] py-10 md:py-14">
        <div className="max-w-3xl mx-auto container-padding text-center">
          <OrnateDivider />

          <GoldFadeIn className="py-8">
            <GitHubIcon
              className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 mx-auto mb-3"
              style={{ color: "var(--text-primary)" }}
            />
            <h2
              className="font-display text-xl sm:text-2xl md:text-3xl mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              100% Open Source
            </h2>
            <p
              className="font-body text-sm sm:text-base md:text-lg max-w-md mx-auto mb-5"
              style={{ color: "var(--text-secondary)" }}
            >
              Hyperscape is fully open source. Contribute to the first AI-native
              MMORPG and help shape the future of gaming.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex items-center gap-2 px-6 py-3 text-base font-display"
            >
              View on GitHub
              <ExternalIcon className="w-4 h-4" />
            </a>
          </GoldFadeIn>

          <OrnateDivider />
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-[2] min-h-[35vh] md:min-h-[40vh] flex items-center overflow-hidden">
        <div
          className="absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
          style={{
            maskImage:
              "linear-gradient(to top, black 0%, black 60%, rgba(0,0,0,0.5) 80%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to top, black 0%, black 60%, rgba(0,0,0,0.5) 80%, transparent 100%)",
          }}
        >
          <Image
            src="/images/gold-cta.png"
            alt=""
            fill
            className="object-cover scale-[1.2] md:scale-100 object-center"
            quality={90}
            loading="lazy"
            sizes="100vw"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(10,10,12,0.85) 0%, rgba(10,10,12,0.5) 50%, rgba(10,10,12,0.85) 100%)",
            }}
          />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto container-padding text-center py-16 md:py-20">
          <GoldFadeIn>
            <h2
              className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl mb-3"
              style={{ color: "var(--text-primary)" }}
            >
              Ready to Get <span className="text-gradient-gold">$GOLD</span>?
            </h2>
          </GoldFadeIn>
          <GoldFadeIn delay={0.1}>
            <p
              className="font-body text-base sm:text-lg md:text-xl max-w-xl mx-auto mb-8"
              style={{ color: "var(--text-secondary)" }}
            >
              Join the adventure and claim your place among the richest players
              in Hyperscape.
            </p>
          </GoldFadeIn>
          <GoldFadeIn delay={0.2}>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-5">
              <Button
                href={PUMP_FUN_URL}
                external
                variant="primary"
                className="px-8 py-4 text-lg"
              >
                Buy $GOLD
              </Button>
              <Button
                href={SOLSCAN_URL}
                external
                variant="secondary"
                className="px-8 py-4 text-lg"
              >
                View Contract
              </Button>
            </div>
          </GoldFadeIn>
          <GoldFadeIn delay={0.3}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Cryptocurrency investments carry risk. Do your own research before
              investing.
            </p>
          </GoldFadeIn>
        </div>
      </section>
    </div>
  );
}
