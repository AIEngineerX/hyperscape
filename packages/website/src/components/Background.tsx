import Image from "next/image";

type BackgroundProps = {
  image?: string;
  opacity?: number;
};

export function Background({
  image = "/images/app_background.png",
  opacity = 0.04,
}: BackgroundProps) {
  return (
    <>
      {/* Layer 1: Steel/stone base */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: "var(--bg-depth)" }}
        aria-hidden="true"
      />
      {/* Layer 2: Mesh gradient — metallic gold glow spots */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: [
            "radial-gradient(ellipse 60% 50% at 15% 30%, var(--gold-glow-cta-faint) 0%, transparent 70%)",
            "radial-gradient(ellipse 50% 60% at 80% 70%, var(--gold-glow-faint) 0%, transparent 60%)",
            "radial-gradient(ellipse 80% 80% at 50% 50%, rgba(26,29,36,0.5) 0%, transparent 70%)",
          ].join(", "),
        }}
        aria-hidden="true"
      />
      {/* Layer 3: Background image — next/image for optimization */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ opacity }}
        aria-hidden="true"
      >
        <Image
          src={image}
          alt=""
          fill
          className="object-cover object-center"
          sizes="100vw"
          priority
        />
      </div>
      {/* Layer 4: Vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 30%, rgba(11,12,14,0.85) 100%)",
        }}
        aria-hidden="true"
      />
    </>
  );
}
