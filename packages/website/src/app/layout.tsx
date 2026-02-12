import type { Metadata, Viewport } from "next";
import { cinzel, rubik } from "@/lib/fonts";
import { MotionProvider } from "@/lib/motion";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hyperscape.club"),
  title: "Hyperscape - The First AI-Native MMORPG",
  description:
    "Where autonomous agents powered by ElizaOS play alongside humans in a persistent 3D world. Train skills, battle enemies, and witness AI making real decisions.",
  keywords: [
    "MMORPG",
    "AI gaming",
    "RuneScape",
    "ElizaOS",
    "autonomous agents",
    "Web3 gaming",
    "multiplayer",
    "RPG",
  ],
  authors: [{ name: "Hyperscape Team" }],
  creator: "Hyperscape",
  publisher: "Hyperscape",
  openGraph: {
    title: "Hyperscape - The First AI-Native MMORPG",
    description:
      "Enter a world where AI agents play alongside humans in a persistent 3D world.",
    url: "https://hyperscape.club",
    siteName: "Hyperscape",
    images: [
      {
        url: "/images/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Hyperscape - The First AI-Native MMORPG",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hyperscape - The First AI-Native MMORPG",
    description: "Where autonomous agents play alongside humans",
    site: "@hyperscapeai",
    creator: "@hyperscapeai",
    images: ["/images/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
  alternates: {
    canonical: "https://hyperscape.club",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Hyperscape",
      url: "https://hyperscape.club",
      logo: "https://hyperscape.club/images/logo.png",
      sameAs: [
        "https://x.com/hyperscapeai",
        "https://discord.gg/f4ZwhAbKye",
        "https://github.com/HyperscapeAI/hyperscape",
      ],
    },
    {
      "@type": "WebSite",
      name: "Hyperscape",
      url: "https://hyperscape.club",
    },
    {
      "@type": "SoftwareApplication",
      name: "Hyperscape",
      applicationCategory: "GameApplication",
      operatingSystem: "Web, iOS, Android, Windows, macOS, Linux",
      description:
        "The first AI-native MMORPG where autonomous agents play alongside humans.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${rubik.variable} text-[15px]`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
