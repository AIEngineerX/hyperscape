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
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            "linear-gradient(to right, #121110 0%, #100f0e 5%, #0f0f11 15%, #0f0f11 85%, #100f0e 95%, #121110 100%)",
        }}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 pointer-events-none z-0 bg-fixed bg-no-repeat"
        style={{
          backgroundImage: `url('${image}')`,
          backgroundSize: "cover",
          backgroundPosition: "center center",
          opacity,
        }}
        aria-hidden="true"
      />
    </>
  );
}
