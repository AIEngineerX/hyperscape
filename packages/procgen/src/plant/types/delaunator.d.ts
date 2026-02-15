/**
 * Type declarations for delaunator
 */
declare module "delaunator" {
  export default class Delaunator {
    constructor(coords: Float64Array | number[]);

    /** Triangle indices - each consecutive triplet forms a triangle */
    triangles: Uint32Array;

    /** Half-edge indices */
    halfedges: Int32Array;

    /** Hull indices */
    hull: Uint32Array;

    /** Get triangle index for a point */
    static from(
      points: ArrayLike<{ x: number; y: number }>,
      getX?: (p: { x: number; y: number }) => number,
      getY?: (p: { x: number; y: number }) => number,
    ): Delaunator;

    /** Update the triangulation */
    update(): void;
  }
}
