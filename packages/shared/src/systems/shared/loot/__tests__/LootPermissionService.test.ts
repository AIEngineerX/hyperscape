/**
 * LootPermissionService Unit Tests
 *
 * Tests the pure permission logic for gravestone looting:
 * - Owner access (always allowed)
 * - Safe area protection (owner-only, no expiration)
 * - Wilderness protection (killer access during timer, public after)
 * - Edge cases (missing protectedFor, expired protection)
 */

import { describe, it, expect } from "vitest";
import {
  canPlayerLoot,
  type LootProtectionData,
} from "../LootPermissionService";

const OWNER_ID = "owner_player";
const KILLER_ID = "killer_player";
const STRANGER_ID = "random_player";

describe("LootPermissionService", () => {
  describe("owner access", () => {
    it("owner can always loot in safe area", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: 0,
        protectedFor: OWNER_ID,
      };
      expect(canPlayerLoot(data, OWNER_ID)).toBe(true);
    });

    it("owner can always loot during wilderness protection", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() + 60_000,
        protectedFor: KILLER_ID,
      };
      expect(canPlayerLoot(data, OWNER_ID)).toBe(true);
    });

    it("owner can always loot after wilderness protection expires", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() - 1000,
        protectedFor: KILLER_ID,
      };
      expect(canPlayerLoot(data, OWNER_ID)).toBe(true);
    });
  });

  describe("safe area (lootProtectionUntil = 0)", () => {
    it("blocks non-owner from looting", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: 0,
        protectedFor: OWNER_ID,
      };
      expect(canPlayerLoot(data, STRANGER_ID)).toBe(false);
    });

    it("blocks non-owner even without protectedFor", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: 0,
      };
      expect(canPlayerLoot(data, STRANGER_ID)).toBe(false);
    });
  });

  describe("wilderness protection (lootProtectionUntil > 0)", () => {
    it("killer can loot during protection period", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() + 60_000,
        protectedFor: KILLER_ID,
      };
      expect(canPlayerLoot(data, KILLER_ID)).toBe(true);
    });

    it("stranger blocked during protection period", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() + 60_000,
        protectedFor: KILLER_ID,
      };
      expect(canPlayerLoot(data, STRANGER_ID)).toBe(false);
    });

    it("anyone can loot after protection expires", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() - 1000,
        protectedFor: KILLER_ID,
      };
      expect(canPlayerLoot(data, STRANGER_ID)).toBe(true);
    });

    it("stranger blocked during protection even without protectedFor", () => {
      const data: LootProtectionData = {
        ownerId: OWNER_ID,
        lootProtectionUntil: Date.now() + 60_000,
      };
      expect(canPlayerLoot(data, STRANGER_ID)).toBe(false);
    });
  });
});
