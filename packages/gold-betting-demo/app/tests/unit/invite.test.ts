import { afterEach, describe, expect, it } from "bun:test";
import {
  captureInviteCodeFromLocation,
  getStoredInviteCode,
  markInviteAppliedForWallet,
  wasInviteAppliedForWallet,
} from "../../src/lib/invite";

type InstalledWindow = {
  setHref: (href: string) => void;
  getHref: () => string;
};

function installMockWindow(initialHref: string): InstalledWindow {
  const globalScope = globalThis as typeof globalThis & {
    window?: {
      location: { href: string };
      history: {
        replaceState: (data: unknown, title: string, url?: string) => void;
      };
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        clear: () => void;
      };
    };
  };

  const storage = new Map<string, string>();
  let currentUrl = new URL(initialHref);

  const location = {} as { href: string };
  Object.defineProperty(location, "href", {
    configurable: true,
    enumerable: true,
    get: () => currentUrl.toString(),
    set: (value: string) => {
      currentUrl = new URL(value, currentUrl.origin);
    },
  });

  globalScope.window = {
    location,
    history: {
      replaceState: (_data: unknown, _title: string, url?: string) => {
        const next = url && url.length > 0 ? url : "/";
        currentUrl = new URL(next, currentUrl.origin);
      },
    },
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
  };

  return {
    setHref: (href: string) => {
      currentUrl = new URL(href, currentUrl.origin);
    },
    getHref: () => currentUrl.toString(),
  };
}

afterEach(() => {
  const globalScope = globalThis as typeof globalThis & { window?: unknown };
  delete globalScope.window;
});

describe("invite link capture + local storage behavior", () => {
  it("stores invite from link, persists after reload, and strips invite query", () => {
    const runtime = installMockWindow(
      "https://hyperscape.bet/?invite=duelfirst01",
    );

    expect(captureInviteCodeFromLocation()).toBe("DUELFIRST01");
    expect(getStoredInviteCode()).toBe("DUELFIRST01");
    expect(runtime.getHref()).toBe("https://hyperscape.bet/");

    runtime.setHref("https://hyperscape.bet/arena");
    expect(captureInviteCodeFromLocation()).toBe("DUELFIRST01");
    expect(getStoredInviteCode()).toBe("DUELFIRST01");
  });

  it("overwrites stored invite when a second referral link is opened", () => {
    const runtime = installMockWindow(
      "https://hyperscape.bet/?invite=duelold01",
    );

    expect(captureInviteCodeFromLocation()).toBe("DUELOLD01");
    expect(getStoredInviteCode()).toBe("DUELOLD01");

    runtime.setHref("https://hyperscape.bet/?ref=duelnew02");
    expect(captureInviteCodeFromLocation()).toBe("DUELNEW02");
    expect(getStoredInviteCode()).toBe("DUELNEW02");
    expect(runtime.getHref()).toBe("https://hyperscape.bet/");
  });

  it("keeps existing invite when a later link is invalid", () => {
    const runtime = installMockWindow(
      "https://hyperscape.bet/?invite=duelkeep03",
    );

    expect(captureInviteCodeFromLocation()).toBe("DUELKEEP03");
    expect(getStoredInviteCode()).toBe("DUELKEEP03");

    runtime.setHref("https://hyperscape.bet/?invite=not-valid!*");
    expect(captureInviteCodeFromLocation()).toBe("DUELKEEP03");
    expect(getStoredInviteCode()).toBe("DUELKEEP03");
  });

  it("tracks invite application per wallet + invite code pair", () => {
    installMockWindow("https://hyperscape.bet/");

    expect(
      wasInviteAppliedForWallet(
        "0x1111111111111111111111111111111111111111",
        "DUELAPPLY01",
      ),
    ).toBe(false);

    markInviteAppliedForWallet(
      "0x1111111111111111111111111111111111111111",
      "DUELAPPLY01",
    );

    expect(
      wasInviteAppliedForWallet(
        "0x1111111111111111111111111111111111111111",
        "DUELAPPLY01",
      ),
    ).toBe(true);

    expect(
      wasInviteAppliedForWallet(
        "0x1111111111111111111111111111111111111111",
        "DUELOTHER02",
      ),
    ).toBe(false);
  });
});
