/**
 * Tests for Turtle 3D graphics.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Turtle, applyTropism } from "../../src/core/Turtle.js";

describe("Turtle", () => {
  describe("initialization", () => {
    it("starts at origin facing up", () => {
      const turtle = new Turtle();

      expect(turtle.pos.x).toBe(0);
      expect(turtle.pos.y).toBe(0);
      expect(turtle.pos.z).toBe(0);
      expect(turtle.dir.z).toBe(1);
    });

    it("has orthonormal basis", () => {
      const turtle = new Turtle();

      // dir and right should be perpendicular
      const dot = turtle.dir.dot(turtle.right);
      expect(Math.abs(dot)).toBeLessThan(0.0001);

      // dir, right, and up should all be unit vectors
      expect(turtle.dir.length()).toBeCloseTo(1, 5);
      expect(turtle.right.length()).toBeCloseTo(1, 5);
      expect(turtle.up.length()).toBeCloseTo(1, 5);
    });

    it("can be created from another turtle", () => {
      const turtle1 = new Turtle();
      turtle1.pos.set(5, 5, 5);
      turtle1.move(10);

      const turtle2 = new Turtle(turtle1);

      expect(turtle2.pos.x).toBeCloseTo(turtle1.pos.x);
      expect(turtle2.pos.y).toBeCloseTo(turtle1.pos.y);
      expect(turtle2.pos.z).toBeCloseTo(turtle1.pos.z);
      expect(turtle2.dir.x).toBeCloseTo(turtle1.dir.x);
      expect(turtle2.dir.y).toBeCloseTo(turtle1.dir.y);
      expect(turtle2.dir.z).toBeCloseTo(turtle1.dir.z);
    });
  });

  describe("movement", () => {
    it("moves forward in direction", () => {
      const turtle = new Turtle();
      turtle.move(5);

      // Default direction is +Z
      expect(turtle.pos.z).toBeCloseTo(5);
      expect(turtle.pos.x).toBeCloseTo(0);
      expect(turtle.pos.y).toBeCloseTo(0);
    });

    it("multiple moves accumulate", () => {
      const turtle = new Turtle();
      turtle.move(3);
      turtle.move(2);

      expect(turtle.pos.z).toBeCloseTo(5);
    });
  });

  describe("turning", () => {
    it("turnRight rotates around up axis", () => {
      const turtle = new Turtle();
      const initialDir = turtle.dir.clone();

      turtle.turnRight(90);

      // After turning right 90 degrees, direction should change
      expect(turtle.dir.dot(initialDir)).toBeCloseTo(0, 1);
    });

    it("turnLeft is opposite of turnRight", () => {
      const turtle1 = new Turtle();
      const turtle2 = new Turtle();

      turtle1.turnRight(45);
      turtle2.turnLeft(-45);

      expect(turtle1.dir.x).toBeCloseTo(turtle2.dir.x, 5);
      expect(turtle1.dir.y).toBeCloseTo(turtle2.dir.y, 5);
      expect(turtle1.dir.z).toBeCloseTo(turtle2.dir.z, 5);
    });

    it("360 degree turn returns to original direction", () => {
      const turtle = new Turtle();
      const originalDir = turtle.dir.clone();

      turtle.turnRight(360);

      expect(turtle.dir.x).toBeCloseTo(originalDir.x, 5);
      expect(turtle.dir.y).toBeCloseTo(originalDir.y, 5);
      expect(turtle.dir.z).toBeCloseTo(originalDir.z, 5);
    });
  });

  describe("pitching", () => {
    it("pitchUp changes direction", () => {
      const turtle = new Turtle();
      const initialDir = turtle.dir.clone();

      turtle.pitchUp(45);

      // Direction should have changed
      expect(turtle.dir.equals(initialDir)).toBe(false);
    });

    it("pitchDown is opposite of pitchUp", () => {
      const turtle1 = new Turtle();
      const turtle2 = new Turtle();

      turtle1.pitchUp(30);
      turtle2.pitchDown(-30);

      expect(turtle1.dir.x).toBeCloseTo(turtle2.dir.x, 5);
      expect(turtle1.dir.y).toBeCloseTo(turtle2.dir.y, 5);
      expect(turtle1.dir.z).toBeCloseTo(turtle2.dir.z, 5);
    });

    it("pitchDown 90 makes turtle face horizontal", () => {
      const turtle = new Turtle();
      turtle.pitchDown(90);

      // After pitching down 90 from vertical, should be horizontal
      expect(Math.abs(turtle.dir.z)).toBeLessThan(0.0001);
    });
  });

  describe("rolling", () => {
    it("rollRight rotates around direction axis", () => {
      const turtle = new Turtle();
      const originalRight = turtle.right.clone();

      turtle.rollRight(90);

      // Right vector should have changed
      expect(turtle.right.dot(originalRight)).toBeCloseTo(0, 1);
    });

    it("rolling does not change direction", () => {
      const turtle = new Turtle();
      const originalDir = turtle.dir.clone();

      turtle.rollRight(45);

      expect(turtle.dir.x).toBeCloseTo(originalDir.x, 5);
      expect(turtle.dir.y).toBeCloseTo(originalDir.y, 5);
      expect(turtle.dir.z).toBeCloseTo(originalDir.z, 5);
    });

    it("maintains orthonormal basis after rolling", () => {
      const turtle = new Turtle();
      turtle.rollRight(37);

      const dot = turtle.dir.dot(turtle.right);
      expect(Math.abs(dot)).toBeLessThan(0.0001);
      expect(turtle.dir.length()).toBeCloseTo(1, 5);
      expect(turtle.right.length()).toBeCloseTo(1, 5);
    });
  });

  describe("clone", () => {
    it("creates independent copy", () => {
      const turtle1 = new Turtle();
      turtle1.move(5);
      turtle1.turnRight(45);

      const turtle2 = turtle1.clone();

      // Modify turtle2
      turtle2.move(10);
      turtle2.turnLeft(90);

      // turtle1 should be unchanged
      expect(turtle1.pos.z).toBeCloseTo(5);
    });
  });

  describe("applyQuaternion", () => {
    it("rotates both dir and right", () => {
      const turtle = new Turtle();
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2,
      );

      const originalDir = turtle.dir.clone();
      turtle.applyQuaternion(quat);

      expect(turtle.dir.dot(originalDir)).toBeCloseTo(0, 1);
    });

    it("maintains orthonormality", () => {
      const turtle = new Turtle();
      const quat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 1, 1).normalize(),
        Math.PI / 3,
      );

      turtle.applyQuaternion(quat);

      expect(turtle.dir.length()).toBeCloseTo(1, 5);
      expect(turtle.right.length()).toBeCloseTo(1, 5);
      expect(Math.abs(turtle.dir.dot(turtle.right))).toBeLessThan(0.0001);
    });
  });
});

describe("applyTropism", () => {
  it("bends turtle toward tropism direction", () => {
    const turtle = new Turtle();
    // Point turtle horizontally instead of vertically
    turtle.dir.set(1, 0, 0).normalize();
    turtle.right.set(0, 1, 0);
    const originalDir = turtle.dir.clone();

    // Apply strong downward tropism (perpendicular to direction)
    applyTropism(turtle, new THREE.Vector3(0, 0, -5));

    // Direction should have changed (tropism perpendicular to dir causes rotation)
    expect(turtle.dir.x).not.toBeCloseTo(originalDir.x, 1);
  });

  it("zero tropism does not change direction", () => {
    const turtle = new Turtle();
    const originalDir = turtle.dir.clone();

    applyTropism(turtle, new THREE.Vector3(0, 0, 0));

    expect(turtle.dir.x).toBeCloseTo(originalDir.x, 5);
    expect(turtle.dir.y).toBeCloseTo(originalDir.y, 5);
    expect(turtle.dir.z).toBeCloseTo(originalDir.z, 5);
  });

  it("tropism parallel to direction has no effect", () => {
    const turtle = new Turtle();
    const originalDir = turtle.dir.clone();

    // Tropism in same direction as turtle
    applyTropism(turtle, new THREE.Vector3(0, 0, 1));

    expect(turtle.dir.x).toBeCloseTo(originalDir.x, 5);
    expect(turtle.dir.y).toBeCloseTo(originalDir.y, 5);
    expect(turtle.dir.z).toBeCloseTo(originalDir.z, 5);
  });
});
