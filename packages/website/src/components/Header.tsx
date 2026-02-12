"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { links } from "@/lib/links";
import { DiscordIcon, TwitterIcon, GitHubIcon } from "./icons";
import { Button } from "./ui/Button";
import { HeaderMobileMenu } from "./HeaderMobileMenu";

const SCROLL_THRESHOLD = 50;

export function Header() {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let ticking = false;

    function updateHeader() {
      const el = headerRef.current;
      if (!el) return;
      const shouldBeScrolled = window.scrollY > SCROLL_THRESHOLD;
      const isScrolled = el.classList.contains("header-scrolled");
      if (shouldBeScrolled !== isScrolled) {
        el.classList.toggle("header-scrolled", shouldBeScrolled);
      }
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(updateHeader);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    updateHeader();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={headerRef}
      className="site-header fixed top-0 left-0 right-0 z-50 border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 pt-[env(safe-area-inset-top,0px)]"
    >
      <div className="w-full container-padding">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/wordmark.png"
              alt="Hyperscape - Home"
              width={160}
              height={32}
              className="h-6 md:h-8 w-auto"
              priority
            />
          </Link>

          {/* Desktop Navigation */}
          <nav
            className="hidden md:flex items-center gap-8"
            aria-label="Main navigation"
          >
            <Link
              href="/gold/"
              className="header-gold-link font-body text-sm transition-colors"
            >
              $GOLD
            </Link>
            <a
              href={links.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body text-sm transition-colors footer-link"
              aria-label="Docs (opens in new tab)"
            >
              Docs
            </a>

            <ul
              className="flex items-center gap-4 list-none"
              aria-label="Social links"
            >
              <li>
                <a
                  href={links.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                  aria-label="Discord (opens in new tab)"
                >
                  <DiscordIcon className="w-5 h-5" />
                </a>
              </li>
              <li>
                <a
                  href={links.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                  aria-label="Twitter / X (opens in new tab)"
                >
                  <TwitterIcon className="w-5 h-5" />
                </a>
              </li>
              <li>
                <a
                  href={links.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                  aria-label="GitHub (opens in new tab)"
                >
                  <GitHubIcon className="w-5 h-5" />
                </a>
              </li>
            </ul>

            <Button
              href={links.game}
              external
              variant="primary"
              aria-label="Play Now (opens in new tab)"
            >
              Play Now
            </Button>
          </nav>

          {/* Mobile Menu (client island) */}
          <HeaderMobileMenu />
        </div>
      </div>
    </header>
  );
}
