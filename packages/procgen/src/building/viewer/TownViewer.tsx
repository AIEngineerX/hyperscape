/**
 * TownViewer
 * React component for viewing generated towns with procedural buildings,
 * including window glass, door trims, and various material styles.
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import {
  WebGPURenderer,
  MeshStandardNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BuildingGenerator, BUILDING_RECIPES } from "../generator";
import {
  TownGenerator,
  type GeneratedTown,
  type TownGenerationStats,
  type TownSize,
} from "../town";
import {
  createBuildingMaterial,
  getMaterialConfigForBuildingType,
  type TSLBuildingMaterial,
} from "../materials";
import {
  NavigationVisualizer,
  type NavigationVisualizerOptions,
} from "./NavigationVisualizer";
import type { TileCoord } from "@hyperscape/shared";

/** Path info for navigation display */
export interface PathInfo {
  start: TileCoord | null;
  end: TileCoord | null;
  length: number;
  partial: boolean;
}

/** Navigation stats for display */
export interface NavStats {
  floors: number;
  walkableTiles: number;
  walls: number;
  doors: number;
  stairs: number;
}

/** Handle for external control of TownViewer */
export interface TownViewerHandle {
  setNavigationEnabled: (enabled: boolean) => void;
  setNavigationOptions: (options: Partial<NavigationVisualizerOptions>) => void;
  getNavigationOptions: () => NavigationVisualizerOptions | null;
  clearNavigationPath: () => void;
  getNavigationStats: () => NavStats | null;
  selectBuilding: (index: number) => void;
}

export interface TownViewerProps {
  /** Initial seed for generation */
  initialSeed?: number;
  /** Initial town size */
  initialSize?: TownSize;
  /** Width of the viewer */
  width?: number | string;
  /** Height of the viewer */
  height?: number | string;
  /** Background color */
  backgroundColor?: number;
  /** Show stats panel */
  showStats?: boolean;
  /** Show controls panel */
  showControls?: boolean;
  /** Callback when town is generated */
  onGenerate?: (town: GeneratedTown, stats: TownGenerationStats) => void;
  /** Enable navigation visualization */
  navigationEnabled?: boolean;
  /** Navigation visualization options */
  navigationOptions?: Partial<NavigationVisualizerOptions>;
  /** Callback when path is updated (for external display) */
  onPathUpdate?: (pathInfo: PathInfo) => void;
  /** Callback when navigation stats change */
  onNavStatsUpdate?: (stats: NavStats | null) => void;
}

// Colors for different building types
const BUILDING_COLORS: Record<string, number> = {
  bank: 0xffd700, // Gold
  store: 0x4169e1, // Royal blue
  smithy: 0xb22222, // Fire brick (replaces anvil - smithy contains forge/anvil)
  inn: 0xdaa520, // Goldenrod
  "simple-house": 0xa0522d, // Sienna
  "long-house": 0xcd853f, // Peru
  church: 0xf5f5dc, // Beige (sacred stone)
  cathedral: 0xfffacd, // Lemon chiffon (grand stone)
  chapel: 0xdcdcdc, // Gainsboro (modest stone)
  keep: 0x696969, // Dim gray (fortified)
  fortress: 0x556b2f, // Dark olive green (military)
  castle: 0x708090, // Slate gray (royalty)
  "guild-hall": 0xd2b48c, // Tan (wood)
  "town-hall": 0xbc8f8f, // Rosy brown (civic)
  mansion: 0xdeb887, // Burlywood (fine brick)
  manor: 0xc0c0c0, // Silver (stone)
  // Legacy types (kept for backwards compatibility)
  anvil: 0xb22222, // Fire brick (same as smithy)
  well: 0x00ced1, // Cyan
  house: 0x8b4513, // Saddle brown
};

export const TownViewer = forwardRef<TownViewerHandle, TownViewerProps>(
  (
    {
      initialSeed = 12345,
      initialSize = "village",
      width = "100%",
      height = 600,
      backgroundColor = 0x1a1a2e,
      showStats = true,
      showControls = true,
      onGenerate,
      navigationEnabled = false,
      navigationOptions,
      onPathUpdate,
      onNavStatsUpdate,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<WebGPURenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const townGroupRef = useRef<THREE.Group | null>(null);
    const buildingGeneratorRef = useRef<BuildingGenerator | null>(null);
    const navigationVisualizerRef = useRef<NavigationVisualizer | null>(null);

    const [seed, setSeed] = useState(initialSeed);
    const [townSize, setTownSize] = useState<TownSize>(initialSize);
    const [currentTown, setCurrentTown] = useState<GeneratedTown | null>(null);
    const [stats, setStats] = useState<TownGenerationStats | null>(null);
    const [showSafeZone, setShowSafeZone] = useState(true);
    const [showBuildings3D, setShowBuildings3D] = useState(true);
    const [showInternalRoads, setShowInternalRoads] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [useProceduralMaterials, setUseProceduralMaterials] = useState(false);
    const [showWindowGlass, setShowWindowGlass] = useState(true);
    const [_selectedBuildingIndex, setSelectedBuildingIndex] = useState(-1);

    // Refs for shared materials
    const glassMaterialRef = useRef<MeshPhysicalNodeMaterial | null>(null);
    const proceduralMaterialsRef = useRef<Map<string, TSLBuildingMaterial>>(
      new Map(),
    );

    // Expose imperative handle for external control
    useImperativeHandle(
      ref,
      () => ({
        setNavigationEnabled: (enabled: boolean) => {
          navigationVisualizerRef.current?.setEnabled(enabled);
        },
        setNavigationOptions: (
          options: Partial<NavigationVisualizerOptions>,
        ) => {
          navigationVisualizerRef.current?.setOptions(options);
        },
        getNavigationOptions: () => {
          return navigationVisualizerRef.current?.getOptions() ?? null;
        },
        clearNavigationPath: () => {
          navigationVisualizerRef.current?.clearUserPath();
        },
        getNavigationStats: () => {
          return navigationVisualizerRef.current?.getStats() ?? null;
        },
        selectBuilding: (index: number) => {
          setSelectedBuildingIndex(index);
          navigationVisualizerRef.current?.selectBuilding(index);
          const navStats = navigationVisualizerRef.current?.getStats() ?? null;
          onNavStatsUpdate?.(navStats);
        },
      }),
      [onNavStatsUpdate],
    );

    // Initialize Three.js scene
    useEffect(() => {
      if (!containerRef.current) return;

      let animationId: number;
      let isDisposed = false;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(backgroundColor);
      sceneRef.current = scene;

      // Camera
      const aspect =
        containerRef.current.clientWidth / containerRef.current.clientHeight;
      const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
      camera.position.set(80, 60, 80);
      cameraRef.current = camera;

      // WebGPU Renderer - async initialization
      const renderer = new WebGPURenderer({ antialias: true });
      renderer.setSize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight,
      );
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.target.set(0, 0, 0);
      controlsRef.current = controls;

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.5);
      scene.add(ambient);

      const sun = new THREE.DirectionalLight(0xffffff, 1.0);
      sun.position.set(50, 80, 50);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 4096;
      sun.shadow.mapSize.height = 4096;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 200;
      sun.shadow.camera.left = -100;
      sun.shadow.camera.right = 100;
      sun.shadow.camera.top = 100;
      sun.shadow.camera.bottom = -100;
      scene.add(sun);

      // Ground plane (WebGPU compatible)
      const groundGeo = new THREE.PlaneGeometry(200, 200);
      const groundMat = new MeshStandardNodeMaterial();
      groundMat.color = new THREE.Color(0x3a5a40);
      groundMat.roughness = 0.9;
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Grid helper
      const grid = new THREE.GridHelper(200, 40, 0x555555, 0x333333);
      grid.position.y = 0.01;
      scene.add(grid);

      // Town group
      townGroupRef.current = new THREE.Group();
      scene.add(townGroupRef.current);

      // Building generator
      buildingGeneratorRef.current = new BuildingGenerator();

      // Navigation visualizer
      const navVisualizer = new NavigationVisualizer(scene, camera);
      navigationVisualizerRef.current = navVisualizer;

      // Set up path update callback
      if (onPathUpdate) {
        navVisualizer.setPathUpdateCallback(onPathUpdate);
      }

      // Click handler for navigation
      const handleCanvasClick = (event: MouseEvent) => {
        if (!navigationVisualizerRef.current?.isEnabled()) return;
        navigationVisualizerRef.current.handleClick(
          event,
          renderer.domElement,
          event.button,
        );
      };

      // Context menu handler to enable right-click for path end
      const handleContextMenu = (event: MouseEvent) => {
        if (navigationVisualizerRef.current?.isEnabled()) {
          event.preventDefault();
        }
      };

      renderer.domElement.addEventListener("click", handleCanvasClick);
      renderer.domElement.addEventListener("contextmenu", handleContextMenu);
      renderer.domElement.addEventListener("mousedown", (e) => {
        if (e.button === 2 && navigationVisualizerRef.current?.isEnabled()) {
          handleCanvasClick(e);
        }
      });

      // Glass material for windows (WebGPU compatible)
      const glassMat = new MeshPhysicalNodeMaterial();
      glassMat.color = new THREE.Color(0x88ccff);
      glassMat.transparent = true;
      glassMat.opacity = 0.35;
      glassMat.roughness = 0.05;
      glassMat.metalness = 0.0;
      glassMat.transmission = 0.6;
      glassMat.thickness = 0.02;
      glassMat.side = THREE.DoubleSide;
      glassMaterialRef.current = glassMat;

      // Animation loop - start after renderer is ready
      const animate = () => {
        if (isDisposed) return;
        animationId = requestAnimationFrame(animate);
        controls.update();
        renderer.renderAsync(scene, camera);
      };

      // Initialize WebGPU renderer and start animation
      renderer
        .init()
        .then(() => {
          if (!isDisposed) {
            animate();
          }
        })
        .catch((err: Error) => {
          console.error("WebGPU initialization failed:", err);
        });

      // Resize handler
      const handleResize = () => {
        if (!containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        isDisposed = true;
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(animationId);

        if (townGroupRef.current) {
          disposeGroup(townGroupRef.current);
        }

        // Dispose navigation visualizer
        if (navigationVisualizerRef.current) {
          navigationVisualizerRef.current.dispose();
          navigationVisualizerRef.current = null;
        }

        ground.geometry.dispose();
        groundMat.dispose();

        // Dispose materials
        if (glassMaterialRef.current) {
          glassMaterialRef.current.dispose();
          glassMaterialRef.current = null;
        }
        proceduralMaterialsRef.current.forEach((mat) => mat.dispose());
        proceduralMaterialsRef.current.clear();

        renderer.dispose();
        buildingGeneratorRef.current?.dispose();
        buildingGeneratorRef.current = null;

        if (
          containerRef.current &&
          renderer.domElement.parentNode === containerRef.current
        ) {
          containerRef.current.removeChild(renderer.domElement);
        }
      };
    }, [backgroundColor, onPathUpdate]);

    // Dispose helper
    const disposeGroup = (group: THREE.Group) => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });
      group.clear();
    };

    // Generate town
    const generateTown = useCallback(() => {
      if (!townGroupRef.current || !buildingGeneratorRef.current) return;

      setIsGenerating(true);

      // Clear existing town
      disposeGroup(townGroupRef.current);

      // Create town generator
      const townGenerator = new TownGenerator({
        seed,
        terrain: {
          getHeightAt: () => 0, // Flat terrain for viewer
          getBiomeAt: () => "plains",
        },
      });

      // Generate single town at origin
      const town = townGenerator.generateSingleTown(0, 0, townSize);
      setCurrentTown(town);

      // Create safe zone circle
      if (showSafeZone) {
        const safeZoneGeo = new THREE.RingGeometry(
          town.safeZoneRadius - 0.5,
          town.safeZoneRadius + 0.5,
          64,
        );
        const safeZoneMat = new MeshBasicNodeMaterial();
        safeZoneMat.color = new THREE.Color(0x00ff00);
        safeZoneMat.transparent = true;
        safeZoneMat.opacity = 0.3;
        safeZoneMat.side = THREE.DoubleSide;
        const safeZoneMesh = new THREE.Mesh(safeZoneGeo, safeZoneMat);
        safeZoneMesh.rotation.x = -Math.PI / 2;
        safeZoneMesh.position.y = 0.02;
        townGroupRef.current.add(safeZoneMesh);
      }

      // Draw internal roads
      if (showInternalRoads && town.internalRoads) {
        const roadWidth = 4;
        for (const road of town.internalRoads) {
          // Calculate road segment relative to town center
          const startX = road.start.x - town.position.x;
          const startZ = road.start.z - town.position.z;
          const endX = road.end.x - town.position.x;
          const endZ = road.end.z - town.position.z;

          const dx = endX - startX;
          const dz = endZ - startZ;
          const length = Math.sqrt(dx * dx + dz * dz);
          const angle = Math.atan2(dz, dx);

          const roadGeo = new THREE.PlaneGeometry(length, roadWidth);
          const roadMat = new MeshStandardNodeMaterial();
          roadMat.color = new THREE.Color(road.isMain ? 0x8b7355 : 0x9a8462); // Darker for main road
          roadMat.roughness = 0.9;
          const roadMesh = new THREE.Mesh(roadGeo, roadMat);
          roadMesh.rotation.x = -Math.PI / 2;
          roadMesh.rotation.z = -angle;
          roadMesh.position.set((startX + endX) / 2, 0.03, (startZ + endZ) / 2);
          townGroupRef.current.add(roadMesh);
        }

        // Draw entry point markers
        if (town.entryPoints) {
          for (const entry of town.entryPoints) {
            const markerGeo = new THREE.CircleGeometry(2, 16);
            const markerMat = new MeshBasicNodeMaterial();
            markerMat.color = new THREE.Color(0xffaa00);
            markerMat.side = THREE.DoubleSide;
            const marker = new THREE.Mesh(markerGeo, markerMat);
            marker.rotation.x = -Math.PI / 2;
            marker.position.set(
              entry.position.x - town.position.x,
              0.04,
              entry.position.z - town.position.z,
            );
            townGroupRef.current.add(marker);
          }
        }
      }

      // Clear old procedural materials
      proceduralMaterialsRef.current.forEach((mat) => mat.dispose());
      proceduralMaterialsRef.current.clear();

      // Add buildings
      for (const building of town.buildings) {
        if (showBuildings3D && BUILDING_RECIPES[building.type]) {
          // Generate 3D building mesh
          const buildingSeed = `${seed}_${building.id}`;
          const result = buildingGeneratorRef.current.generate(building.type, {
            seed: buildingSeed,
            includeRoof: true,
          });

          if (result) {
            // Create a group for this building
            const buildingGroup = new THREE.Group();
            buildingGroup.name = `building-${building.type}-${building.id}`;

            // Determine material
            let buildingMaterial: THREE.Material;
            if (useProceduralMaterials) {
              // Get or create procedural material for this building type
              if (!proceduralMaterialsRef.current.has(building.type)) {
                const config = getMaterialConfigForBuildingType(building.type);
                proceduralMaterialsRef.current.set(
                  building.type,
                  createBuildingMaterial(config),
                );
              }
              buildingMaterial = proceduralMaterialsRef.current.get(
                building.type,
              )!;
            } else {
              const stdMat = new MeshStandardNodeMaterial();
              stdMat.vertexColors = true;
              stdMat.roughness = 0.85;
              stdMat.metalness = 0.05;
              buildingMaterial = stdMat;
            }

            // Add main mesh
            if (result.mesh instanceof THREE.Mesh) {
              result.mesh.material = buildingMaterial;
              result.mesh.castShadow = true;
              result.mesh.receiveShadow = true;
              buildingGroup.add(result.mesh);
            } else if (result.mesh instanceof THREE.Group) {
              result.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = buildingMaterial;
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
              buildingGroup.add(result.mesh);
            }

            // Add window glass from geometryArrays
            if (
              result.geometryArrays &&
              showWindowGlass &&
              glassMaterialRef.current
            ) {
              const { windowGlass } = result.geometryArrays;
              if (windowGlass && windowGlass.length > 0) {
                for (const glassGeo of windowGlass) {
                  const glassMesh = new THREE.Mesh(
                    glassGeo,
                    glassMaterialRef.current,
                  );
                  glassMesh.name = "window-glass";
                  glassMesh.renderOrder = 1;
                  buildingGroup.add(glassMesh);
                }
              }
            }

            buildingGroup.position.set(
              building.position.x - town.position.x,
              0,
              building.position.z - town.position.z,
            );
            buildingGroup.rotation.y = building.rotation;
            townGroupRef.current.add(buildingGroup);
          }
        } else {
          // Simple colored box placeholder
          const buildingGeo = new THREE.BoxGeometry(
            building.size.width,
            4,
            building.size.depth,
          );
          const buildingMat = new MeshStandardNodeMaterial();
          buildingMat.color = new THREE.Color(
            BUILDING_COLORS[building.type] ?? 0x888888,
          );
          buildingMat.roughness = 0.8;
          const buildingMesh = new THREE.Mesh(buildingGeo, buildingMat);
          buildingMesh.position.set(
            building.position.x - town.position.x,
            2,
            building.position.z - town.position.z,
          );
          buildingMesh.rotation.y = building.rotation;
          buildingMesh.castShadow = true;
          buildingMesh.receiveShadow = true;
          townGroupRef.current.add(buildingMesh);
        }

        // Add building label
        const labelCanvas = document.createElement("canvas");
        labelCanvas.width = 256;
        labelCanvas.height = 64;
        const ctx = labelCanvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(0, 0, 256, 64);
          ctx.font = "bold 24px Arial";
          ctx.fillStyle = "white";
          ctx.textAlign = "center";
          ctx.fillText(building.type.toUpperCase(), 128, 40);
        }

        const labelTexture = new THREE.CanvasTexture(labelCanvas);
        const labelMat = new THREE.SpriteMaterial({ map: labelTexture });
        const label = new THREE.Sprite(labelMat);
        label.position.set(
          building.position.x - town.position.x,
          8,
          building.position.z - town.position.z,
        );
        label.scale.set(8, 2, 1);
        townGroupRef.current.add(label);
      }

      // Create stats
      const generationStats: TownGenerationStats = {
        totalTowns: 1,
        hamlets: town.size === "hamlet" ? 1 : 0,
        villages: town.size === "village" ? 1 : 0,
        towns: town.size === "town" ? 1 : 0,
        totalBuildings: town.buildings.length,
        buildingCounts: {
          bank: 0,
          store: 0,
          anvil: 0,
          well: 0,
          house: 0,
          inn: 0,
          smithy: 0,
          "simple-house": 0,
          "long-house": 0,
          church: 0,
          cathedral: 0,
          chapel: 0,
          keep: 0,
          fortress: 0,
          castle: 0,
          "guild-hall": 0,
          "town-hall": 0,
          mansion: 0,
          manor: 0,
        },
        candidatesEvaluated: 1,
        generationTime: 0,
      };

      for (const b of town.buildings) {
        generationStats.buildingCounts[b.type]++;
      }

      setStats(generationStats);
      setIsGenerating(false);
      onGenerate?.(town, generationStats);

      // Update navigation visualizer with town data
      if (navigationVisualizerRef.current && buildingGeneratorRef.current) {
        navigationVisualizerRef.current.setTown(town, {
          generate: (type: string, opts: { seed: string }) => {
            return (
              buildingGeneratorRef.current?.generate(type, {
                seed: opts.seed,
                includeRoof: true,
              }) ?? null
            );
          },
        });
        setSelectedBuildingIndex(-1);
        onNavStatsUpdate?.(null); // No specific building selected
      }
    }, [
      seed,
      townSize,
      showSafeZone,
      showBuildings3D,
      showInternalRoads,
      useProceduralMaterials,
      showWindowGlass,
      onGenerate,
      onNavStatsUpdate,
    ]);

    // Generate initial town
    useEffect(() => {
      generateTown();
    }, [generateTown]);

    // Sync navigation enabled state
    useEffect(() => {
      if (navigationVisualizerRef.current) {
        navigationVisualizerRef.current.setEnabled(navigationEnabled);
      }
    }, [navigationEnabled]);

    // Sync navigation options
    useEffect(() => {
      if (navigationVisualizerRef.current && navigationOptions) {
        navigationVisualizerRef.current.setOptions(navigationOptions);
      }
    }, [navigationOptions]);

    return (
      <div style={{ position: "relative", width, height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {showControls && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              background: "rgba(0, 0, 0, 0.8)",
              padding: 16,
              borderRadius: 8,
              color: "white",
              fontSize: 13,
              minWidth: 200,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 12, fontSize: 15 }}>
              Town Generator
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Town Size
              </label>
              <select
                value={townSize}
                onChange={(e) => setTownSize(e.target.value as TownSize)}
                style={{
                  width: "100%",
                  padding: 6,
                  borderRadius: 4,
                  border: "none",
                  background: "#333",
                  color: "white",
                }}
              >
                <option value="hamlet">Hamlet (3-5 buildings)</option>
                <option value="village">Village (6-10 buildings)</option>
                <option value="town">Town (11-16 buildings)</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", marginBottom: 4 }}>Seed</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                style={{
                  width: "100%",
                  padding: 6,
                  borderRadius: 4,
                  border: "none",
                  background: "#333",
                  color: "white",
                }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showSafeZone}
                  onChange={(e) => setShowSafeZone(e.target.checked)}
                />
                Show Safe Zone
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showBuildings3D}
                  onChange={(e) => setShowBuildings3D(e.target.checked)}
                />
                3D Buildings (slower)
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showInternalRoads}
                  onChange={(e) => setShowInternalRoads(e.target.checked)}
                />
                Show Roads
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={useProceduralMaterials}
                  onChange={(e) => setUseProceduralMaterials(e.target.checked)}
                />
                Procedural Materials
              </label>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showWindowGlass}
                  onChange={(e) => setShowWindowGlass(e.target.checked)}
                />
                Window Glass
              </label>
            </div>

            <button
              onClick={generateTown}
              disabled={isGenerating}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "none",
                background: isGenerating ? "#666" : "#4a9eff",
                color: "white",
                cursor: isGenerating ? "not-allowed" : "pointer",
                fontWeight: "bold",
              }}
            >
              {isGenerating ? "Generating..." : "Generate Town"}
            </button>

            <button
              onClick={() => setSeed(Math.floor(Math.random() * 1000000))}
              style={{
                width: "100%",
                padding: 8,
                marginTop: 8,
                borderRadius: 4,
                border: "1px solid #555",
                background: "transparent",
                color: "white",
                cursor: "pointer",
              }}
            >
              Random Seed
            </button>
          </div>
        )}

        {showStats && currentTown && stats && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              background: "rgba(0, 0, 0, 0.8)",
              padding: 16,
              borderRadius: 8,
              color: "white",
              fontSize: 12,
              minWidth: 180,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 10, fontSize: 14 }}>
              {currentTown.name}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Size:</strong> {currentTown.size}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Safe Zone:</strong> {currentTown.safeZoneRadius}m
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Biome:</strong> {currentTown.biome}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Layout:</strong> {currentTown.layoutType ?? "unknown"}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Roads:</strong> {currentTown.internalRoads?.length ?? 0}{" "}
              segments
            </div>

            <div style={{ marginTop: 12, marginBottom: 8, fontWeight: "bold" }}>
              Buildings ({stats.totalBuildings})
            </div>

            {Object.entries(stats.buildingCounts)
              .filter(([, count]) => count > 0)
              .map(([type, count]) => (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: `#${(BUILDING_COLORS[type] ?? 0x888888).toString(16).padStart(6, "0")}`,
                    }}
                  />
                  <span style={{ textTransform: "capitalize" }}>
                    {type.replace("-", " ")}: {count}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Legend */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0, 0, 0, 0.7)",
            padding: 10,
            borderRadius: 6,
            color: "white",
            fontSize: 11,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            Building Types
          </div>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 300 }}
          >
            {Object.entries(BUILDING_COLORS).map(([type, color]) => (
              <div
                key={type}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: `#${color.toString(16).padStart(6, "0")}`,
                  }}
                />
                <span style={{ textTransform: "capitalize" }}>
                  {type.replace("-", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
);

TownViewer.displayName = "TownViewer";

export default TownViewer;
