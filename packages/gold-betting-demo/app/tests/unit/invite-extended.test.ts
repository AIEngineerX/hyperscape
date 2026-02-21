import { afterEach, describe, expect, it } from "bun:test";
import {
  normalizeInviteCode,
  extractInviteCodeFromInput,
  buildInviteShareLink,
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
      location: { href: string; origin: string; pathname: string };
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

  const location = {} as {
    href: string;
    origin: string;
    pathname: string;
  };

  Object.defineProperty(location, "href", {
    configurable: true,
    enumerable: true,
    get: () => currentUrl.toString(),
    set: (value: string) => {
      currentUrl = new URL(value, currentUrl.origin);
    },
  });
  Object.defineProperty(location, "origin", {
    configurable: true,
    enumerable: true,
    get: () => currentUrl.origin,
  });
  Object.defineProperty(location, "pathname", {
    configurable: true,
    enumerable: true,
    get: () => currentUrl.pathname,
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

describe("normalizeInviteCode", () => {
  it("uppercases valid codes", () => {
    expect(normalizeInviteCode("dueltest01")).toBe("DUELTEST01");
  });

  it("trims whitespace", () => {
    expect(normalizeInviteCode("  DUELTEST01  ")).toBe("DUELTEST01");
  });

  it("returns null for null/undefined/empty", () => {
    expect(normalizeInviteCode(null)).toBeNull();
    expect(normalizeInviteCode(undefined)).toBeNull();
    expect(normalizeInviteCode("")).toBeNull();
    expect(normalizeInviteCode("   ")).toBeNull();
  });

  it("rejects codes shorter than 4 characters", () => {
    expect(normalizeInviteCode("AB")).toBeNull();
    expect(normalizeInviteCode("ABC")).toBeNull();
  });

  it("accepts codes at minimum length (4 chars)", () => {
    expect(normalizeInviteCode("ABCD")).toBe("ABCD");
  });

  it("accepts codes with hyphens and underscores", () => {
    expect(normalizeInviteCode("DUEL-TEST_01")).toBe("DUEL-TEST_01");
  });

  it("rejects codes with special characters", () => {
    expect(normalizeInviteCode("DUEL!TEST")).toBeNull();
    expect(normalizeInviteCode("DUEL@TEST")).toBeNull();
    expect(normalizeInviteCode("DUEL TEST")).toBeNull();
    expect(normalizeInviteCode("DUEL.TEST")).toBeNull();
  });

  it("rejects codes longer than 64 characters", () => {
    const longCode = "A".repeat(65);
    expect(normalizeInviteCode(longCode)).toBeNull();
  });

  it("accepts codes at maximum length (64 chars)", () => {
    const maxCode = "A".repeat(64);
    expect(normalizeInviteCode(maxCode)).toBe(maxCode);
  });
});

describe("extractInviteCodeFromInput", () => {
  it("extracts plain invite code", () => {
    expect(extractInviteCodeFromInput("DUELTEST01")).toBe("DUELTEST01");
  });

  it("extracts from URL with invite param", () => {
    expect(
      extractInviteCodeFromInput("https://hyperscape.bet/?invite=DUELTEST01"),
    ).toBe("DUELTEST01");
  });

  it("extracts from URL with ref param", () => {
    expect(
      extractInviteCodeFromInput("https://hyperscape.bet/?ref=DUELREF02"),
    ).toBe("DUELREF02");
  });

  it("extracts from URL with inviteCode param", () => {
    expect(
      extractInviteCodeFromInput(
        "https://hyperscape.bet/?inviteCode=DUELCODE03",
      ),
    ).toBe("DUELCODE03");
  });

  it("returns null for invalid URL with no matching params", () => {
    expect(
      extractInviteCodeFromInput("https://hyperscape.bet/?foo=bar"),
    ).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractInviteCodeFromInput("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(extractInviteCodeFromInput("   ")).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(extractInviteCodeFromInput("not-a-url://???")).toBeNull();
  });

  it("normalizes case from URL param", () => {
    expect(
      extractInviteCodeFromInput("https://hyperscape.bet/?invite=dueltest01"),
    ).toBe("DUELTEST01");
  });

  it("prioritizes invite over ref param", () => {
    expect(
      extractInviteCodeFromInput(
        "https://hyperscape.bet/?invite=CODE1&ref=CODE2",
      ),
    ).toBe("CODE1");
  });
});

describe("buildInviteShareLink", () => {
  it("returns empty string for invalid codes", () => {
    expect(buildInviteShareLink("")).toBe("");
    expect(buildInviteShareLink("AB")).toBe("");
  });

  it("builds link with hyperscape.bet origin when no window", () => {
    const link = buildInviteShareLink("DUELTEST01");
    expect(link).toBe("https://hyperscape.bet/?invite=DUELTEST01");
  });

  it("uses window origin when available", () => {
    installMockWindow("https://mysite.com/arena");
    const link = buildInviteShareLink("DUELTEST01");
    expect(link).toContain("mysite.com");
    expect(link).toContain("invite=DUELTEST01");
  });

  it("normalizes case in the link", () => {
    const link = buildInviteShareLink("dueltest01");
    expect(link).toContain("invite=DUELTEST01");
  });
});

describe("captureInviteCodeFromLocation + getStoredInviteCode", () => {
  it("captures from invite query param and strips it", () => {
    const runtime = installMockWindow(
      "https://hyperscape.bet/?invite=DUELCAP01",
    );
    expect(captureInviteCodeFromLocation()).toBe("DUELCAP01");
    expect(getStoredInviteCode()).toBe("DUELCAP01");
    expect(runtime.getHref()).toBe("https://hyperscape.bet/");
  });

  it("captures from ref query param", () => {
    const runtime = installMockWindow("https://hyperscape.bet/?ref=DUELREF01");
    expect(captureInviteCodeFromLocation()).toBe("DUELREF01");
    expect(runtime.getHref()).toBe("https://hyperscape.bet/");
  });

  it("falls back to stored code when no query param present", () => {
    installMockWindow("https://hyperscape.bet/?invite=STORED01");
    captureInviteCodeFromLocation();

    const runtime = installMockWindow("https://hyperscape.bet/");
    // Manually re-set stored code since window was reinstalled
    (
      globalThis as typeof globalThis & {
        window: { localStorage: { setItem: (k: string, v: string) => void } };
      }
    ).window.localStorage.setItem("arena:invite:code", "STORED01");

    expect(captureInviteCodeFromLocation()).toBe("STORED01");
    expect(runtime.getHref()).toBe("https://hyperscape.bet/");
  });

  it("returns null when no query param and no stored code", () => {
    installMockWindow("https://hyperscape.bet/");
    expect(captureInviteCodeFromLocation()).toBeNull();
  });

  it("preserves other query params when stripping invite", () => {
    const runtime = installMockWindow(
      "https://hyperscape.bet/arena?invite=CODE01&theme=dark",
    );
    captureInviteCodeFromLocation();
    expect(runtime.getHref()).toContain("theme=dark");
    expect(runtime.getHref()).not.toContain("invite=");
  });
});

describe("wasInviteAppliedForWallet + markInviteAppliedForWallet", () => {
  it("returns false before marking", () => {
    installMockWindow("https://hyperscape.bet/");
    expect(wasInviteAppliedForWallet("0xWALLET1", "CODE01")).toBe(false);
  });

  it("returns true after marking", () => {
    installMockWindow("https://hyperscape.bet/");
    markInviteAppliedForWallet("0xWALLET1", "CODE01");
    expect(wasInviteAppliedForWallet("0xWALLET1", "CODE01")).toBe(true);
  });

  it("is scoped per wallet", () => {
    installMockWindow("https://hyperscape.bet/");
    markInviteAppliedForWallet("0xWALLET1", "CODE01");
    expect(wasInviteAppliedForWallet("0xWALLET2", "CODE01")).toBe(false);
  });

  it("is scoped per invite code", () => {
    installMockWindow("https://hyperscape.bet/");
    markInviteAppliedForWallet("0xWALLET1", "CODE01");
    expect(wasInviteAppliedForWallet("0xWALLET1", "CODE02")).toBe(false);
  });

  it("handles invalid inputs gracefully", () => {
    installMockWindow("https://hyperscape.bet/");
    markInviteAppliedForWallet("", "CODE01");
    expect(wasInviteAppliedForWallet("", "CODE01")).toBe(false);

    markInviteAppliedForWallet("0xWALLET1", "AB");
    expect(wasInviteAppliedForWallet("0xWALLET1", "AB")).toBe(false);
  });

  it("returns false without window", () => {
    expect(wasInviteAppliedForWallet("0xWALLET1", "CODE01")).toBe(false);
  });
});
