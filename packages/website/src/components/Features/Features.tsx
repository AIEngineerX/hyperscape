import Image from "next/image";
import { links } from "@/lib/links";
import { Button } from "../ui/Button";
import { ArrowRightIcon, GitHubIcon } from "../icons";
import { FeatureAnimations } from "./FeatureAnimations";

type FeatureCardProps = {
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  href?: string;
  delay?: number;
  showGitHub?: boolean;
};

function FeatureCard({
  title,
  description,
  imageSrc,
  imageAlt,
  href,
  delay = 0,
  showGitHub = false,
}: FeatureCardProps) {
  return (
    <FeatureAnimations delay={delay}>
      <div className="flex flex-col group h-full">
        {/* Image container */}
        <div
          className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden mb-5 transition-transform duration-300 group-hover:scale-[1.02]"
          style={{
            background:
              "linear-gradient(135deg, rgba(30, 30, 34, 0.9) 0%, rgba(20, 20, 22, 0.95) 100%)",
            border: "1px solid rgba(212, 168, 75, 0.1)",
          }}
        >
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            className="object-cover object-center"
            loading="lazy"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
          {/* Hover shine effect */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{
              background:
                "linear-gradient(135deg, rgba(212, 168, 75, 0.08) 0%, transparent 50%)",
            }}
          />
        </div>

        <h3
          className="font-display text-xl sm:text-2xl md:text-3xl mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h3>

        <p
          className="font-body text-sm sm:text-base md:text-lg leading-relaxed mb-4 flex-grow"
          style={{ color: "var(--text-secondary)" }}
        >
          {description}
        </p>

        {href && !showGitHub && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-body text-sm sm:text-base transition-colors group/link"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="group-hover/link:text-[var(--gold-essence)] transition-colors">
              Read more
            </span>
            <ArrowRightIcon className="w-4 h-4 transition-transform group-hover/link:translate-x-1" />
          </a>
        )}

        {showGitHub && (
          <Button
            href={links.github}
            external
            variant="secondary"
            className="gap-2 self-start"
          >
            <GitHubIcon className="w-5 h-5" />
            View on GitHub
          </Button>
        )}
      </div>
    </FeatureAnimations>
  );
}

const features = [
  {
    title: "AI That Actually Plays",
    description:
      "ElizaOS-powered agents make real decisions. They grind skills, form strategies, trade items, and interact with players — all autonomously.",
    imageSrc: "/images/ai-image.png",
    imageAlt: "AI agents playing the game autonomously",
    href: "https://hyperscape-ai.mintlify.app/guides/ai-agents",
    showGitHub: false,
  },
  {
    title: "Classic Mechanics",
    description:
      "Tick-based combat, skill progression, and equipment systems inspired by the games you love. Built for the web with no downloads required.",
    imageSrc: "/images/classic-image.png",
    imageAlt: "Classic MMORPG combat system",
    href: "https://hyperscape-ai.mintlify.app/concepts/combat",
    showGitHub: false,
  },
  {
    title: "Your World, Your Rules",
    description:
      "Open source and extensible. Add NPCs, items, quests, and entire regions through simple manifest files. The community shapes the world.",
    imageSrc: "/images/thumbs-up-guy.png",
    imageAlt: "Open source game character giving thumbs up",
    href: links.github,
    showGitHub: true,
  },
];

export function Features() {
  return (
    <section
      className="relative"
      style={{ padding: "var(--spacing-section) 0" }}
    >
      <div className="max-w-6xl mx-auto container-padding">
        <FeatureAnimations className="text-center mb-12 md:mb-16 lg:mb-20">
          <p
            className="font-body text-sm sm:text-base md:text-lg uppercase tracking-widest mb-3"
            style={{ color: "var(--gold-essence)" }}
          >
            Why Hyperscape
          </p>
          <h2
            className="font-display text-2xl sm:text-3xl md:text-4xl lg:text-5xl"
            style={{ color: "var(--text-primary)" }}
          >
            A New Kind of World
          </h2>
        </FeatureAnimations>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-10 lg:gap-12">
          {features.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              imageSrc={feature.imageSrc}
              imageAlt={feature.imageAlt}
              href={feature.href}
              delay={index * 0.1}
              showGitHub={feature.showGitHub}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
