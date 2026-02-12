import Image from "next/image";
import { links, navigation } from "@/lib/links";
import { DiscordIcon, TwitterIcon, GitHubIcon } from "./icons";

type FooterLinkProps = {
  href: string;
  children: React.ReactNode;
  external?: boolean;
};

function FooterLink({ href, children, external = false }: FooterLinkProps) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="block font-body text-sm relative group footer-link"
    >
      {children}
      <span
        className="absolute bottom-0 left-0 w-0 h-px transition-all duration-300 group-hover:w-full"
        style={{ background: "var(--gold-essence)" }}
      />
    </a>
  );
}

export function Footer() {
  return (
    <footer
      className="relative z-[3] pt-16 pb-8"
      style={{ background: "var(--bg-depth)" }}
    >
      <div className="max-w-6xl mx-auto container-padding">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <Image
              src="/images/wordmark.png"
              alt="Hyperscape"
              width={140}
              height={28}
              className="h-6 w-auto mb-4"
            />
            <p
              className="text-sm font-body leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              The first AI-native MMORPG where autonomous agents play alongside
              humans.
            </p>
          </div>

          {/* Game Links */}
          <nav aria-label="Game links">
            <h3
              className="font-display text-sm uppercase tracking-wider mb-4"
              style={{ color: "var(--text-primary)" }}
            >
              Game
            </h3>
            <ul className="space-y-3">
              {navigation.footer.game.map((link) => (
                <li key={link.label}>
                  <FooterLink href={link.href} external={link.external}>
                    {link.label}
                  </FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Community Links */}
          <nav aria-label="Community links">
            <h3
              className="font-display text-sm uppercase tracking-wider mb-4"
              style={{ color: "var(--text-primary)" }}
            >
              Community
            </h3>
            <ul className="space-y-3">
              {navigation.footer.community.map((link) => (
                <li key={link.label}>
                  <FooterLink href={link.href} external={link.external}>
                    {link.label}
                  </FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Resources Links */}
          <nav aria-label="Resources">
            <h3
              className="font-display text-sm uppercase tracking-wider mb-4"
              style={{ color: "var(--text-primary)" }}
            >
              Resources
            </h3>
            <ul className="space-y-3">
              {navigation.footer.resources.map((link) => (
                <li key={link.label}>
                  <FooterLink href={link.href} external={link.external}>
                    {link.label}
                  </FooterLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom Bar */}
        <div
          className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <p
            className="text-sm font-body"
            style={{ color: "var(--text-muted)" }}
          >
            &copy; {new Date().getFullYear()} Hyperscape. All rights reserved.
          </p>

          <div className="flex items-center gap-6">
            <a
              href={links.discord}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="Discord"
            >
              <DiscordIcon className="w-5 h-5" />
            </a>
            <a
              href={links.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="Twitter / X"
            >
              <TwitterIcon className="w-5 h-5" />
            </a>
            <a
              href={links.github}
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="GitHub"
            >
              <GitHubIcon className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
