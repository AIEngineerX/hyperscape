import Image from "next/image";
import Link from "next/link";
import { links } from "@/lib/links";
import { DiscordIcon, TwitterIcon, GitHubIcon } from "./icons";
import { Button } from "./ui/Button";
import { HeaderMobileMenu } from "./HeaderMobileMenu";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-transparent transition-all duration-300">
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
              className="font-body text-sm transition-colors"
              style={{ color: "var(--gold-essence)" }}
            >
              $GOLD
            </Link>
            <a
              href={links.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body text-sm transition-colors footer-link"
            >
              Docs
            </a>

            <div
              className="flex items-center gap-4"
              role="list"
              aria-label="Social links"
            >
              <a
                href={links.discord}
                target="_blank"
                rel="noopener noreferrer"
                className="social-link"
                aria-label="Discord"
                role="listitem"
              >
                <DiscordIcon className="w-5 h-5" />
              </a>
              <a
                href={links.twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="social-link"
                aria-label="Twitter / X"
                role="listitem"
              >
                <TwitterIcon className="w-5 h-5" />
              </a>
              <a
                href={links.github}
                target="_blank"
                rel="noopener noreferrer"
                className="social-link"
                aria-label="GitHub"
                role="listitem"
              >
                <GitHubIcon className="w-5 h-5" />
              </a>
            </div>

            <Button href={links.game} external variant="primary">
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
