/**
 * Advanced Noise Generation for Procedural Terrain
 *
 * Implements multiple noise algorithms for realistic terrain generation:
 * - Perlin Noise: Smooth, organic noise for base terrain
 * - Simplex Noise: Perlin with better characteristics
 * - Ridge Noise: For mountain ridges and sharp features
 * - Turbulence: For chaotic terrain details
 * - Fractal Noise: Multi-octave noise for complex terrain
 */

export class NoiseGenerator {
  private p: number[] = [];

  constructor(seed: number = 12345) {
    this.initializePermutation(seed);
  }

  private initializePermutation(seed: number): void {
    // Initialize permutation table with seed
    const perm = Array.from({ length: 256 }, (_, i) => i);

    // Shuffle using seeded random (LCG algorithm)
    let random = seed;
    for (let i = perm.length - 1; i > 0; i--) {
      random = (random * 1664525 + 1013904223) % 4294967296;
      const j = Math.floor((random / 4294967296) * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }

    this.p = [...perm, ...perm]; // Duplicate for overflow
  }

  /**
   * 2D Perlin Noise - Classic algorithm for smooth, organic terrain
   * @returns Value in range [-1, 1]
   */
  perlin2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);

    const u = this.fade(x);
    const v = this.fade(y);

    const A = this.p[X] + Y;
    const AA = this.p[A];
    const AB = this.p[A + 1];
    const B = this.p[X + 1] + Y;
    const BA = this.p[B];
    const BB = this.p[B + 1];

    const result = this.lerp(
      v,
      this.lerp(
        u,
        this.grad2D(this.p[AA], x, y),
        this.grad2D(this.p[BA], x - 1, y),
      ),
      this.lerp(
        u,
        this.grad2D(this.p[AB], x, y - 1),
        this.grad2D(this.p[BB], x - 1, y - 1),
      ),
    );

    // Clamp to ensure we stay within [-1, 1]
    return Math.max(-1, Math.min(1, result));
  }

  /**
   * 2D Simplex Noise - Perlin with better characteristics and no directional artifacts
   * @returns Value in approximately [-1, 1] range
   */
  simplex2D(x: number, y: number): number {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.p[ii + this.p[jj]] % 12;
    const gi1 = this.p[ii + i1 + this.p[jj + j1]] % 12;
    const gi2 = this.p[ii + 1 + this.p[jj + 1]] % 12;

    let n0: number, n1: number, n2: number;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) {
      n0 = 0.0;
    } else {
      t0 *= t0;
      n0 = t0 * t0 * this.gradSimplex2D(gi0, x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) {
      n1 = 0.0;
    } else {
      t1 *= t1;
      n1 = t1 * t1 * this.gradSimplex2D(gi1, x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) {
      n2 = 0.0;
    } else {
      t2 *= t2;
      n2 = t2 * t2 * this.gradSimplex2D(gi2, x2, y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }

  /**
   * Ridge Noise - Creates sharp mountain ridges
   * @returns Value in range [0, 1]
   */
  ridgeNoise2D(x: number, y: number): number {
    const perlinValue = this.perlin2D(x, y);
    // Ensure perlin value is in valid range before processing
    const clampedPerlin = Math.max(-1, Math.min(1, perlinValue));
    return 1.0 - Math.abs(clampedPerlin);
  }

  /**
   * Turbulence - Absolute value of noise for chaotic terrain
   * @returns Value >= 0
   */
  turbulence2D(x: number, y: number, octaves: number = 4): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;

    for (let i = 0; i < octaves; i++) {
      value +=
        Math.abs(this.perlin2D(x * frequency, y * frequency)) * amplitude;
      frequency *= 2;
      amplitude *= 0.5;
    }

    return value;
  }

  /**
   * Fractal Noise (FBM) - Multi-octave noise for complex terrain
   * @returns Value in approximately [-1, 1] range
   */
  fractal2D(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0,
  ): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += this.perlin2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  /**
   * Domain Warping - Distorts noise input for more organic results
   */
  domainWarp2D(
    x: number,
    y: number,
    warpStrength: number = 0.1,
  ): { x: number; y: number } {
    const warpX = x + warpStrength * this.perlin2D(x + 5.2, y + 1.3);
    const warpY = y + warpStrength * this.perlin2D(x + 7.8, y + 4.6);
    return { x: warpX, y: warpY };
  }

  /**
   * Erosion Simulation - Simulates hydraulic erosion effects
   */
  erosionNoise2D(x: number, y: number, iterations: number = 3): number {
    let height = this.fractal2D(x, y, 6);

    for (let i = 0; i < iterations; i++) {
      const gradient = this.calculateGradient(x, y);
      const erosionFactor = Math.min(1.0, gradient.magnitude * 2.0);
      height *= 1.0 - erosionFactor * 0.1;
    }

    return height;
  }

  /**
   * Temperature Map - For biome generation
   */
  temperatureMap(x: number, y: number, latitude: number = 0): number {
    // Base temperature decreases with latitude (distance from equator)
    const latitudeEffect = 1.0 - Math.abs(latitude) * 0.8;

    // Add noise variation
    const temperatureNoise = this.fractal2D(x * 0.001, y * 0.001, 3) * 0.3;

    return Math.max(0, Math.min(1, latitudeEffect + temperatureNoise));
  }

  /**
   * Moisture Map - For biome generation
   */
  moistureMap(x: number, y: number): number {
    return (this.fractal2D(x * 0.002, y * 0.002, 4) + 1) * 0.5;
  }

  // ============== Helper Functions ==============

  private fade(t: number): number {
    // 6t^5 - 15t^4 + 10t^3 (Ken Perlin's improved fade function)
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad2D(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }

  private gradSimplex2D(hash: number, x: number, y: number): number {
    const grad3 = [
      [1, 1, 0],
      [-1, 1, 0],
      [1, -1, 0],
      [-1, -1, 0],
      [1, 0, 1],
      [-1, 0, 1],
      [1, 0, -1],
      [-1, 0, -1],
      [0, 1, 1],
      [0, -1, 1],
      [0, 1, -1],
      [0, -1, -1],
    ];
    return grad3[hash % 12][0] * x + grad3[hash % 12][1] * y;
  }

  private calculateGradient(
    x: number,
    y: number,
    delta: number = 0.01,
  ): { x: number; y: number; magnitude: number } {
    const heightCenter = this.perlin2D(x, y);
    const heightX = this.perlin2D(x + delta, y);
    const heightY = this.perlin2D(x, y + delta);

    const gradX = (heightX - heightCenter) / delta;
    const gradY = (heightY - heightCenter) / delta;
    const magnitude = Math.sqrt(gradX * gradX + gradY * gradY);

    return { x: gradX, y: gradY, magnitude };
  }
}

/**
 * Create a seeded PRNG (Linear Congruential Generator)
 * Useful for deterministic random placement
 */
export function createSeededRNG(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // LCG parameters (Numerical Recipes)
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Create a deterministic PRNG for a specific tile and salt
 * Ensures identical generation across different contexts for the same seed
 */
export function createTileRNG(
  baseSeed: number,
  tileX: number,
  tileZ: number,
  salt: string,
): () => number {
  // Simple string hash (djb2 variant) for salt
  let saltHash = 5381 >>> 0;
  for (let i = 0; i < salt.length; i++) {
    saltHash = (((saltHash << 5) + saltHash) ^ salt.charCodeAt(i)) >>> 0;
  }

  // Mix all values into initial state
  let state =
    ((baseSeed >>> 0) ^
      ((tileX * 73856093) >>> 0) ^
      ((tileZ * 19349663) >>> 0) ^
      saltHash) >>>
    0;

  return () => {
    // LCG parameters (Numerical Recipes)
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
