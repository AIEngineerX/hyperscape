import Image from "next/image";
import { Button } from "../ui/Button";
import { links } from "@/lib/links";
import { HeroAnimations } from "./HeroAnimations";

export function Hero() {
  return (
    <section className="relative min-h-[55vh] md:min-h-[65vh] lg:min-h-[75vh]">
      {/* Full-width banner image with mask fade at bottom */}
      <div
        className="absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 0%, black 70%, rgba(0,0,0,0.5) 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 70%, rgba(0,0,0,0.5) 85%, transparent 100%)",
        }}
      >
        <Image
          src="/images/hero-image.png"
          alt=""
          fill
          className="object-cover scale-[1.6] md:scale-[1.35] lg:scale-[1.4] object-[78%_center] md:object-[65%_center]"
          priority
          quality={90}
          sizes="100vw"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(10,10,12,0.9) 0%, rgba(10,10,12,0.6) 40%, rgba(10,10,12,0.3) 100%)",
          }}
        />
      </div>

      {/* Content */}
      <div className="absolute inset-0 z-10 flex items-center">
        <div className="max-w-6xl mx-auto container-padding w-full">
          <HeroAnimations>
            <div className="flex flex-col items-center md:items-start gap-6 md:gap-8 text-center md:text-left">
              <Image
                src="/images/wordmark.png"
                alt="Hyperscape"
                width={1000}
                height={200}
                className="w-56 sm:w-64 md:w-80 lg:w-[28rem] h-auto"
                priority
              />

              <p
                className="font-body text-base sm:text-lg md:text-xl lg:text-2xl max-w-sm md:max-w-lg lg:max-w-xl"
                style={{ color: "var(--text-secondary)" }}
              >
                The first AI-native MMORPG where autonomous agents play
                alongside humans
              </p>

              <Button
                href={links.game}
                external
                variant="primary"
                className="text-base sm:text-lg px-6 sm:px-8 py-3 sm:py-4 animate-glow-pulse"
              >
                Play Now
              </Button>
            </div>
          </HeroAnimations>
        </div>
      </div>
    </section>
  );
}
