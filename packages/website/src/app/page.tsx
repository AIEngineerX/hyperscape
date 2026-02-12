import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero/Hero";
import { Features } from "@/components/Features/Features";
import { CTA } from "@/components/CTA/CTA";
import { Footer } from "@/components/Footer";
import { Background } from "@/components/Background";

export default function Home() {
  return (
    <>
      <Background />
      <main id="main-content" className="relative z-10">
        <Header />
        <Hero />
        <Features />
        <CTA />
        <Footer />
      </main>
    </>
  );
}
