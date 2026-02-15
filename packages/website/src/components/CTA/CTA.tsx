import Image from "next/image";
import { Button } from "../ui/Button";
import { links } from "@/lib/links";
import { FadeIn } from "@/lib/motion";

export function CTA() {
  return (
    <section className="relative overflow-hidden">
      {/* Metallic gold line — TOP edge */}
      <div aria-hidden="true" className="gold-border-line top-0" />

      {/* Top vignette — thin fade from the gold line into the image */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 z-[1] h-16 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, transparent 0%, rgba(11,12,14,0.85) 60%, var(--bg-depth) 100%)",
        }}
      />

      {/* Background image — absolute, fills section */}
      <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <Image
          src="/images/cta-banner.png"
          alt=""
          fill
          className="object-cover scale-[1.5] md:scale-[1.15] object-center"
          quality={90}
          loading="lazy"
          sizes="100vw"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(10,10,12,0.85) 0%, rgba(10,10,12,0.6) 50%, rgba(10,10,12,0.85) 100%)",
          }}
        />
      </div>

      {/* Bottom vignette — fade into footer background */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 z-[1] h-16 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(11,12,14,0.85) 60%, var(--bg-depth) 100%)",
        }}
      />

      {/* Content — padding-driven height */}
      <div className="relative z-10 pt-16 sm:pt-20 md:pt-24 pb-16 sm:pb-20 md:pb-24">
        <div className="max-w-4xl mx-auto container-padding text-center cta-glow">
          <FadeIn>
            <div className="relative z-10">
              <div
                className="divider-gold mx-auto max-w-xs mb-8"
                aria-hidden="true"
              >
                <span className="w-1.5 h-1.5 rotate-45 bg-[var(--gold-dim)] shrink-0" />
              </div>

              <h2 className="heading-section text-shimmer-gold mb-5">
                Ready to Enter the World?
              </h2>

              <p
                className="font-body text-lg md:text-xl mb-8 max-w-2xl mx-auto"
                style={{ color: "var(--text-secondary)" }}
              >
                Join thousands of players and AI agents in the first truly
                AI-native MMORPG.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  href={links.game}
                  external
                  variant="primary"
                  className="btn-sweep"
                  aria-label="Play Now — It's Free (opens in new tab)"
                >
                  Play Now — It&apos;s Free
                </Button>
                <Button
                  href={links.discord}
                  external
                  variant="secondary"
                  aria-label="Join Discord (opens in new tab)"
                >
                  Join Discord
                </Button>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
