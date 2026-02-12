import Image from "next/image";
import { FadeIn } from "@/lib/motion";
import { GoldDivider } from "./GoldDivider";
import { TokenHero } from "./TokenHero";
import { ValueProps } from "./ValueProps";
import { HowItWorks } from "./HowItWorks";
import { OpenSource } from "./OpenSource";
import { GoldCTA } from "./GoldCTA";

export { TOKEN_ADDRESS } from "@/lib/constants";

export function GoldToken() {
  return (
    <div className="relative overflow-hidden">
      {/* Hero Section */}
      <section className="relative z-[2] -mt-16 md:-mt-20 pt-40 pb-10 md:pt-48 md:pb-12">
        <div
          className="absolute inset-0 z-0 overflow-hidden"
          aria-hidden="true"
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

        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, transparent 40%, rgba(11,12,14,0.6) 55%, rgba(11,12,14,0.95) 70%, var(--bg-depth) 85%)",
          }}
        />

        <div className="relative z-10 max-w-4xl mx-auto container-padding">
          <TokenHero />
        </div>
      </section>

      {/* Features Header */}
      <section
        className="relative z-[2] pt-12 md:pt-16 pb-4 section-bleed"
        style={{ background: "var(--bg-depth)" }}
      >
        <div className="max-w-3xl mx-auto container-padding text-center">
          <FadeIn>
            <p
              className="label-upper mb-3"
              style={{ color: "var(--gold-essence)" }}
            >
              Why $GOLD
            </p>
            <h2 className="heading-section text-shimmer-gold mb-2">Features</h2>
          </FadeIn>
          <GoldDivider wide />
        </div>
      </section>

      <ValueProps />
      <HowItWorks />
      <OpenSource />
      <GoldCTA />
    </div>
  );
}
