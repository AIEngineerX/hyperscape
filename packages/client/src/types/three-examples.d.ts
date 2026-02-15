// Type declarations for three.js examples/jsm modules
// These modules don't ship with their own types, so we declare them here

declare module "three/examples/jsm/loaders/GLTFLoader.js" {
  import * as THREE from "three";

  export interface GLTF {
    animations: THREE.AnimationClip[];
    scene: THREE.Group;
    scenes: THREE.Group[];
    cameras: THREE.Camera[];
    asset: {
      copyright?: string;
      generator?: string;
      version?: string;
      minVersion?: string;
      extensions?: Record<string, unknown>;
      extras?: Record<string, unknown>;
    };
    parser: GLTFParser;
    userData: Record<string, unknown>;
  }

  export interface GLTFParser {
    json: Record<string, unknown>;
    extensions: Record<string, unknown>;
    plugins: Record<string, unknown>;
    options: Record<string, unknown>;
    cache: Map<string, unknown>;
    associations: Map<THREE.Object3D, { meshes?: number; nodes?: number }>;
    getDependency(type: string, index: number): Promise<unknown>;
    getDependencies(type: string): Promise<unknown[]>;
    loadBuffer(bufferIndex: number): Promise<ArrayBuffer>;
    loadBufferView(bufferViewIndex: number): Promise<ArrayBuffer>;
    loadAccessor(
      accessorIndex: number,
    ): Promise<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>;
  }

  export class GLTFLoader extends THREE.Loader {
    constructor(manager?: THREE.LoadingManager);

    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: Error) => void,
    ): void;

    loadAsync(
      url: string,
      onProgress?: (event: ProgressEvent) => void,
    ): Promise<GLTF>;

    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (error: Error) => void,
    ): void;

    parseAsync(data: ArrayBuffer | string, path: string): Promise<GLTF>;

    setDRACOLoader(loader: unknown): GLTFLoader;
    setKTX2Loader(loader: unknown): GLTFLoader;
    setMeshoptDecoder(decoder: unknown): GLTFLoader;
    register(callback: (parser: GLTFParser) => unknown): GLTFLoader;
    unregister(callback: (parser: GLTFParser) => unknown): GLTFLoader;
  }
}
