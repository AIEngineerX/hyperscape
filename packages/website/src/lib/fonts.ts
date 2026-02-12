import { Cinzel, Crimson_Text, MedievalSharp } from "next/font/google";

export const cinzel = Cinzel({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
});

export const crimsonText = Crimson_Text({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

export const medievalSharp = MedievalSharp({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-accent",
  weight: ["400"],
});
