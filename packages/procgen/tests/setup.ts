/**
 * Test setup for tree-gen package
 */

// Extend expect with custom matchers for floating point comparisons
expect.extend({
  toBeCloseToVector(
    received: { x: number; y: number; z: number },
    expected: { x: number; y: number; z: number },
    precision = 6,
  ) {
    const epsilon = Math.pow(10, -precision);
    const pass =
      Math.abs(received.x - expected.x) < epsilon &&
      Math.abs(received.y - expected.y) < epsilon &&
      Math.abs(received.z - expected.z) < epsilon;

    if (pass) {
      return {
        message: () =>
          `expected (${received.x}, ${received.y}, ${received.z}) not to be close to (${expected.x}, ${expected.y}, ${expected.z})`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `expected (${received.x}, ${received.y}, ${received.z}) to be close to (${expected.x}, ${expected.y}, ${expected.z})`,
        pass: false,
      };
    }
  },
});

// Type augmentation for custom matchers
declare module "vitest" {
  interface Assertion<T> {
    toBeCloseToVector(
      expected: { x: number; y: number; z: number },
      precision?: number,
    ): T;
  }
  interface AsymmetricMatchersContaining {
    toBeCloseToVector(
      expected: { x: number; y: number; z: number },
      precision?: number,
    ): void;
  }
}
