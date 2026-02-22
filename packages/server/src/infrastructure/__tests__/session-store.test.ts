import { describe, it, expect } from "vitest";
import { InMemorySessionStore, type SessionStore } from "../session-store";

interface TestSession {
  id: string;
  name: string;
  score: number;
}

describe("InMemorySessionStore", () => {
  it("implements SessionStore interface", () => {
    const store: SessionStore<TestSession> = new InMemorySessionStore();
    expect(store).toBeDefined();
  });

  describe("CRUD operations", () => {
    it("set and get", () => {
      const store = new InMemorySessionStore<TestSession>();
      const session: TestSession = { id: "1", name: "Alice", score: 100 };

      store.set("1", session);
      expect(store.get("1")).toBe(session);
    });

    it("get returns undefined for missing key", () => {
      const store = new InMemorySessionStore<TestSession>();
      expect(store.get("missing")).toBeUndefined();
    });

    it("has returns true/false correctly", () => {
      const store = new InMemorySessionStore<TestSession>();
      expect(store.has("1")).toBe(false);
      store.set("1", { id: "1", name: "Bob", score: 50 });
      expect(store.has("1")).toBe(true);
    });

    it("delete removes and returns true", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("1", { id: "1", name: "Charlie", score: 75 });

      expect(store.delete("1")).toBe(true);
      expect(store.get("1")).toBeUndefined();
      expect(store.has("1")).toBe(false);
    });

    it("delete returns false for missing key", () => {
      const store = new InMemorySessionStore<TestSession>();
      expect(store.delete("missing")).toBe(false);
    });

    it("overwrite existing key", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("1", { id: "1", name: "Old", score: 0 });
      store.set("1", { id: "1", name: "New", score: 100 });
      expect(store.get("1")!.name).toBe("New");
      expect(store.size).toBe(1);
    });
  });

  describe("size", () => {
    it("starts at 0", () => {
      const store = new InMemorySessionStore<TestSession>();
      expect(store.size).toBe(0);
    });

    it("increases on set", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("a", { id: "a", name: "A", score: 1 });
      store.set("b", { id: "b", name: "B", score: 2 });
      expect(store.size).toBe(2);
    });

    it("decreases on delete", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("a", { id: "a", name: "A", score: 1 });
      store.set("b", { id: "b", name: "B", score: 2 });
      store.delete("a");
      expect(store.size).toBe(1);
    });
  });

  describe("entries", () => {
    it("iterates over all entries", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("a", { id: "a", name: "A", score: 1 });
      store.set("b", { id: "b", name: "B", score: 2 });

      const entries = [...store.entries()];
      expect(entries).toHaveLength(2);
      expect(entries.map(([k]) => k).sort()).toEqual(["a", "b"]);
    });

    it("returns empty iterator when store is empty", () => {
      const store = new InMemorySessionStore<TestSession>();
      expect([...store.entries()]).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.set("a", { id: "a", name: "A", score: 1 });
      store.set("b", { id: "b", name: "B", score: 2 });

      store.clear();
      expect(store.size).toBe(0);
      expect(store.get("a")).toBeUndefined();
      expect(store.get("b")).toBeUndefined();
    });

    it("is safe to call on empty store", () => {
      const store = new InMemorySessionStore<TestSession>();
      store.clear();
      expect(store.size).toBe(0);
    });
  });
});
