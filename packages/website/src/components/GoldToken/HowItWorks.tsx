import { FadeIn } from "@/lib/motion";
import { GoldDivider } from "./GoldDivider";
import { howItWorks } from "@/lib/gold-data";

export function HowItWorks() {
  return (
    <section
      className="relative z-[2] py-10 md:py-14"
      style={{ background: "var(--bg-depth)" }}
    >
      <div className="max-w-4xl mx-auto container-padding">
        <FadeIn className="text-center mb-8">
          <h2 className="heading-section text-shimmer-gold mb-2">
            How It Works
          </h2>
          <GoldDivider />
        </FadeIn>

        {/* Desktop: horizontal with simple arrows */}
        <div className="hidden md:flex items-start justify-center">
          {howItWorks.map((item, i) => (
            <div key={item.num} className="flex items-start">
              <FadeIn delay={i * 0.1}>
                <div className="flex flex-col items-center text-center w-44 lg:w-48">
                  <span className="quest-step-num text-2xl lg:text-3xl mb-3">
                    {item.num}
                  </span>
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
              </FadeIn>

              {i < howItWorks.length - 1 && (
                <div
                  className="flex items-center px-3 lg:px-5 pt-5"
                  aria-hidden="true"
                >
                  <svg
                    className="w-8 h-4"
                    viewBox="0 0 32 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient
                        id={`arrow-${i}`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="0"
                      >
                        <stop offset="0%" stopColor="var(--gold-glow-alt-sm)" />
                        <stop offset="50%" stopColor="var(--gold-shimmer)" />
                        <stop
                          offset="100%"
                          stopColor="var(--gold-glow-alt-sm)"
                        />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 8h28M24 3l6 5-6 5"
                      stroke={`url(#arrow-${i})`}
                      strokeWidth="1.5"
                      fill="none"
                    />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile: vertical layout */}
        <div className="flex flex-col gap-4 md:hidden">
          {howItWorks.map((item, i) => (
            <FadeIn key={item.num} delay={i * 0.1}>
              <div className="card-premium p-4 flex items-start gap-4">
                <span className="quest-step-num text-xl flex-shrink-0">
                  {item.num}
                </span>
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
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
