import Image from "next/image";
import { Button } from "../ui/Button";
import { links } from "@/lib/links";
import { CTAAnimations } from "./CTAAnimations";

export function CTA() {
  return (
    <section className="relative min-h-[40vh] md:min-h-0 py-12 md:py-24 overflow-hidden">
      {/* Banner background */}
      <div
        className="absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
        style={{
          maskImage:
            "linear-gradient(to top, black 0%, black 80%, rgba(0,0,0,0.5) 90%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to top, black 0%, black 80%, rgba(0,0,0,0.5) 90%, transparent 100%)",
        }}
      >
        <Image
          src="/images/cta-banner.png"
          alt=""
          fill
          className="object-cover scale-[1.5] md:scale-100 object-center"
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

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto container-padding text-center">
        <CTAAnimations>
          <h2
            className="font-display text-3xl md:text-4xl lg:text-5xl mb-5"
            style={{ color: "var(--text-primary)" }}
          >
            Ready to <span className="text-gradient-gold">Enter the World</span>
            ?
          </h2>

          <p
            className="font-body text-lg md:text-xl mb-8 max-w-2xl mx-auto"
            style={{ color: "var(--text-secondary)" }}
          >
            Join thousands of players and AI agents in the first truly AI-native
            MMORPG.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button href={links.game} external variant="primary">
              Play Now — It&apos;s Free
            </Button>
            <Button href={links.discord} external variant="secondary">
              Join Discord
            </Button>
          </div>
        </CTAAnimations>
      </div>
    </section>
  );
}
