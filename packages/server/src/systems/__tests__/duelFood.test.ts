import { describe, expect, it } from "vitest";
import {
  DUEL_FOOD_ITEM_IDS,
  getDuelFoodItemForLevels,
  isDuelFoodItemId,
} from "../duelFood";

describe("duelFood helpers", () => {
  it("uses weak food for equal levels", () => {
    expect(getDuelFoodItemForLevels(1, 1)).toBe("shrimp");
    expect(getDuelFoodItemForLevels(99, 99)).toBe("shrimp");
  });

  it("uses strong food for large level gaps", () => {
    expect(getDuelFoodItemForLevels(1, 99)).toBe("shark");
    expect(getDuelFoodItemForLevels(99, 1)).toBe("shark");
  });

  it("recognizes duel-food ids and suffixed variants", () => {
    expect(isDuelFoodItemId("shrimp")).toBe(true);
    expect(isDuelFoodItemId("noted_shrimp")).toBe(true);
    expect(isDuelFoodItemId("bronze_sword")).toBe(false);
    expect(DUEL_FOOD_ITEM_IDS).toContain("shark");
  });
});
