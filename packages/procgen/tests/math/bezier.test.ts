/**
 * Tests for Bezier curve utilities.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  calcPointOnBezier,
  calcTangentToBezier,
  createBezierPoint,
  bezierArcLength,
  type BezierSplinePoint,
} from "../../src/math/Bezier.js";

describe("Bezier", () => {
  const createSimpleSegment = (): {
    start: BezierSplinePoint;
    end: BezierSplinePoint;
  } => {
    return {
      start: {
        co: new THREE.Vector3(0, 0, 0),
        handleLeft: new THREE.Vector3(-1, 0, 0),
        handleRight: new THREE.Vector3(1, 0, 0),
      },
      end: {
        co: new THREE.Vector3(3, 0, 0),
        handleLeft: new THREE.Vector3(2, 0, 0),
        handleRight: new THREE.Vector3(4, 0, 0),
      },
    };
  };

  describe("calcPointOnBezier", () => {
    it("returns start point at t=0", () => {
      const { start, end } = createSimpleSegment();
      const point = calcPointOnBezier(0, start, end);

      expect(point.x).toBeCloseTo(0);
      expect(point.y).toBeCloseTo(0);
      expect(point.z).toBeCloseTo(0);
    });

    it("returns end point at t=1", () => {
      const { start, end } = createSimpleSegment();
      const point = calcPointOnBezier(1, start, end);

      expect(point.x).toBeCloseTo(3);
      expect(point.y).toBeCloseTo(0);
      expect(point.z).toBeCloseTo(0);
    });

    it("returns midpoint approximately at t=0.5 for symmetric curve", () => {
      const { start, end } = createSimpleSegment();
      const point = calcPointOnBezier(0.5, start, end);

      // For this symmetric curve, midpoint should be near x=1.5
      expect(point.x).toBeCloseTo(1.5, 0);
      expect(point.y).toBeCloseTo(0);
      expect(point.z).toBeCloseTo(0);
    });

    it("throws for out-of-range offset", () => {
      const { start, end } = createSimpleSegment();

      expect(() => calcPointOnBezier(-0.1, start, end)).toThrow();
      expect(() => calcPointOnBezier(1.1, start, end)).toThrow();
    });

    it("handles 3D curves", () => {
      const start: BezierSplinePoint = {
        co: new THREE.Vector3(0, 0, 0),
        handleLeft: new THREE.Vector3(-1, -1, -1),
        handleRight: new THREE.Vector3(1, 1, 1),
      };
      const end: BezierSplinePoint = {
        co: new THREE.Vector3(3, 3, 3),
        handleLeft: new THREE.Vector3(2, 2, 2),
        handleRight: new THREE.Vector3(4, 4, 4),
      };

      const point = calcPointOnBezier(0.5, start, end);

      // Midpoint should be approximately (1.5, 1.5, 1.5)
      expect(point.x).toBeCloseTo(1.5, 0);
      expect(point.y).toBeCloseTo(1.5, 0);
      expect(point.z).toBeCloseTo(1.5, 0);
    });
  });

  describe("calcTangentToBezier", () => {
    it("returns non-zero tangent at start", () => {
      const { start, end } = createSimpleSegment();
      const tangent = calcTangentToBezier(0.001, start, end);

      expect(tangent.length()).toBeGreaterThan(0);
    });

    it("returns non-zero tangent at end", () => {
      const { start, end } = createSimpleSegment();
      const tangent = calcTangentToBezier(0.999, start, end);

      expect(tangent.length()).toBeGreaterThan(0);
    });

    it("tangent is approximately along x-axis for horizontal curve", () => {
      const { start, end } = createSimpleSegment();
      const tangent = calcTangentToBezier(0.5, start, end).normalize();

      // For horizontal curve, tangent should be mostly along x
      expect(Math.abs(tangent.x)).toBeGreaterThan(0.9);
      expect(Math.abs(tangent.y)).toBeLessThan(0.1);
      expect(Math.abs(tangent.z)).toBeLessThan(0.1);
    });
  });

  describe("createBezierPoint", () => {
    it("creates point with symmetric handles", () => {
      const position = new THREE.Vector3(5, 5, 5);
      const tangent = new THREE.Vector3(0, 0, 1);
      const handleLength = 2;

      const point = createBezierPoint(position, tangent, handleLength);

      expect(point.co.x).toBe(5);
      expect(point.co.y).toBe(5);
      expect(point.co.z).toBe(5);

      expect(point.handleLeft.z).toBe(3); // 5 - 2
      expect(point.handleRight.z).toBe(7); // 5 + 2
    });
  });

  describe("bezierArcLength", () => {
    it("calculates approximate length of straight line", () => {
      const start: BezierSplinePoint = {
        co: new THREE.Vector3(0, 0, 0),
        handleLeft: new THREE.Vector3(0, 0, 0),
        handleRight: new THREE.Vector3(1, 0, 0),
      };
      const end: BezierSplinePoint = {
        co: new THREE.Vector3(3, 0, 0),
        handleLeft: new THREE.Vector3(2, 0, 0),
        handleRight: new THREE.Vector3(3, 0, 0),
      };

      const length = bezierArcLength(start, end);

      // Should be approximately 3
      expect(length).toBeCloseTo(3, 0);
    });

    it("length is greater for curved paths", () => {
      const straightStart: BezierSplinePoint = {
        co: new THREE.Vector3(0, 0, 0),
        handleLeft: new THREE.Vector3(0, 0, 0),
        handleRight: new THREE.Vector3(1, 0, 0),
      };
      const straightEnd: BezierSplinePoint = {
        co: new THREE.Vector3(3, 0, 0),
        handleLeft: new THREE.Vector3(2, 0, 0),
        handleRight: new THREE.Vector3(3, 0, 0),
      };

      const curvedStart: BezierSplinePoint = {
        co: new THREE.Vector3(0, 0, 0),
        handleLeft: new THREE.Vector3(0, -1, 0),
        handleRight: new THREE.Vector3(0, 3, 0), // Curve up
      };
      const curvedEnd: BezierSplinePoint = {
        co: new THREE.Vector3(3, 0, 0),
        handleLeft: new THREE.Vector3(3, 3, 0), // Curve down
        handleRight: new THREE.Vector3(3, 1, 0),
      };

      const straightLength = bezierArcLength(straightStart, straightEnd);
      const curvedLength = bezierArcLength(curvedStart, curvedEnd);

      expect(curvedLength).toBeGreaterThan(straightLength);
    });
  });
});
