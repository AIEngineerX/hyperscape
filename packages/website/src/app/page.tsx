import { Header } from "@/components/Header";

export const dynamic = "force-static";
import { Hero } from "@/components/Hero/Hero";
import { Features } from "@/components/Features/Features";
import { CTA } from "@/components/CTA/CTA";
import { Footer } from "@/components/Footer";
import { Background } from "@/components/Background";

export default function Home() {
  return (
    <>
      <Background />
      <Header />
      <main id="main-content" className="relative z-10">
        <Hero />
        <Features />
        <CTA />
        <Footer />
      </main>
    </>
  );
}
