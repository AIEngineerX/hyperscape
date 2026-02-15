/**
 * BuildingViewer
 * React component for viewing generated buildings with procedural materials,
 * window panes, door trims, and various visual options.
 */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import * as THREE from "three";
import {
  WebGPURenderer,
  MeshStandardNodeMaterial,
  MeshPhysicalNodeMaterial,
} from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  BuildingGenerator,
  BUILDING_RECIPES,
  type BuildingStats,
  generateInteriorLights,
  bakeVertexLighting,
  createWallSconceGeometry,
  createChandelierGeometry,
  createFixtureMaterials,
  type BuildingLayout,
} from "../generator";
import {
  createBuildingMaterial,
  getMaterialConfigForBuildingType,
  type BuildingMaterialType,
  type TSLBuildingMaterial,
} from "../materials";
import {
  NavigationVisualizer,
  type NavigationVisualizerOptions,
} from "./NavigationVisualizer";
import type { TileCoord } from "@hyperscape/shared";

/** Available material styles for the viewer */
const MATERIAL_OPTIONS: {
  value: BuildingMaterialType | "vertex-colors";
  label: string;
}[] = [
  { value: "vertex-colors", label: "Vertex Colors (Classic)" },
  { value: "brick", label: "Brick" },
  { value: "stone-ashlar", label: "Stone (Ashlar)" },
  { value: "stone-rubble", label: "Stone (Rubble)" },
  { value: "wood-plank", label: "Wood Planks" },
  { value: "timber-frame", label: "Timber Frame" },
  { value: "plaster", label: "Plaster/Stucco" },
];

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

/** Handle for external control of BuildingViewer */
export interface BuildingViewerHandle {
  setNavigationEnabled: (enabled: boolean) => void;
  setNavigationOptions: (options: Partial<NavigationVisualizerOptions>) => void;
  getNavigationOptions: () => NavigationVisualizerOptions | null;
  clearNavigationPath: () => void;
  getNavigationStats: () => NavStats | null;
}

export interface BuildingViewerProps {
  /** Initial building type to display */
  initialType?: string;
  /** Initial seed for generation */
  initialSeed?: string;
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
  /** Callback when building is generated */
  onGenerate?: (stats: BuildingStats, typeKey: string, seed: string) => void;
  /** Enable navigation visualization */
  navigationEnabled?: boolean;
  /** Navigation visualization options */
  navigationOptions?: Partial<NavigationVisualizerOptions>;
  /** Callback when path is updated (for external display) */
  onPathUpdate?: (pathInfo: PathInfo) => void;
  /** Callback when navigation stats change */
  onNavStatsUpdate?: (stats: NavStats | null) => void;
}

export const BuildingViewer = forwardRef<
  BuildingViewerHandle,
  BuildingViewerProps
>(
  (
    {
      initialType = "inn",
      initialSeed = "",
      width = "100%",
      height = 400,
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
    const generatorRef = useRef<BuildingGenerator | null>(null);
    const currentBuildingRef = useRef<THREE.Mesh | THREE.Group | null>(null);
    const materialRef = useRef<TSLBuildingMaterial | null>(null);
    const glassMaterialRef = useRef<MeshPhysicalNodeMaterial | null>(null);
    const navigationVisualizerRef = useRef<NavigationVisualizer | null>(null);
    const currentLayoutRef = useRef<BuildingLayout | null>(null);

    const [buildingType, setBuildingType] = useState(initialType);
    const [seed, setSeed] = useState(initialSeed);
    const [stats, setStats] = useState<BuildingStats | null>(null);
    const [includeRoof, setIncludeRoof] = useState(true);
    const [materialType, setMaterialType] = useState<
      BuildingMaterialType | "vertex-colors"
    >("vertex-colors");
    const [showWindowGlass, setShowWindowGlass] = useState(true);
    const [showDoorTrims, setShowDoorTrims] = useState(true);
    const [enableInteriorLighting, setEnableInteriorLighting] = useState(true);
    const [showLightFixtures, setShowLightFixtures] = useState(true);
    const interiorLightsRef = useRef<THREE.Group | null>(null);
    const pointLightsRef = useRef<THREE.PointLight[]>([]);

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
      }),
      [],
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
      const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
      camera.position.set(15, 12, 15);
      cameraRef.current = camera;

      // WebGPU Renderer
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
      controls.target.set(0, 3, 0);
      controlsRef.current = controls;

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.4);
      scene.add(ambient);

      const sun = new THREE.DirectionalLight(0xffffff, 1.0);
      sun.position.set(20, 30, 20);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 2048;
      sun.shadow.mapSize.height = 2048;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 100;
      sun.shadow.camera.left = -30;
      sun.shadow.camera.right = 30;
      sun.shadow.camera.top = 30;
      sun.shadow.camera.bottom = -30;
      scene.add(sun);

      // Ground plane (WebGPU compatible)
      const groundGeo = new THREE.PlaneGeometry(50, 50);
      const groundMat = new MeshStandardNodeMaterial();
      groundMat.color = new THREE.Color(0x3a5a40);
      groundMat.roughness = 0.9;
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Grid helper
      const grid = new THREE.GridHelper(50, 50, 0x555555, 0x333333);
      grid.position.y = 0.01;
      scene.add(grid);

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

      // Generator
      generatorRef.current = new BuildingGenerator();

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

        // Dispose current building geometry
        if (currentBuildingRef.current) {
          disposeObject(currentBuildingRef.current);
          currentBuildingRef.current = null;
        }

        // Dispose navigation visualizer
        if (navigationVisualizerRef.current) {
          navigationVisualizerRef.current.dispose();
          navigationVisualizerRef.current = null;
        }

        // Dispose ground plane
        ground.geometry.dispose();
        groundMat.dispose();

        // Dispose materials
        if (materialRef.current) {
          materialRef.current.dispose();
          materialRef.current = null;
        }
        if (glassMaterialRef.current) {
          glassMaterialRef.current.dispose();
          glassMaterialRef.current = null;
        }

        renderer.dispose();
        generatorRef.current?.dispose();
        generatorRef.current = null;

        if (
          containerRef.current &&
          renderer.domElement.parentNode === containerRef.current
        ) {
          containerRef.current.removeChild(renderer.domElement);
        }
      };
    }, [backgroundColor, onPathUpdate]);

    // Helper to dispose Three.js objects recursively
    const disposeObject = (obj: THREE.Object3D) => {
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
      obj.children.forEach((child) => disposeObject(child));
    };

    // Generate building
    const generateBuilding = useCallback(() => {
      if (!sceneRef.current || !generatorRef.current) return;

      // Remove old building and dispose geometry
      if (currentBuildingRef.current) {
        sceneRef.current.remove(currentBuildingRef.current);
        disposeObject(currentBuildingRef.current);
        currentBuildingRef.current = null;
      }

      // Dispose old procedural material if any
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }

      // Generate new building
      const actualSeed = seed || `${buildingType}_${Date.now()}`;
      const result = generatorRef.current.generate(buildingType, {
        seed: actualSeed,
        includeRoof,
      });

      if (result) {
        // Create building group
        const buildingGroup = new THREE.Group();
        buildingGroup.name = `building-${buildingType}`;

        // Determine which material to use
        let wallMaterial: THREE.Material;
        if (materialType === "vertex-colors") {
          // Use the generator's built-in vertex color material (WebGPU compatible)
          const vertexColorMat = new MeshStandardNodeMaterial();
          vertexColorMat.vertexColors = true;
          vertexColorMat.roughness = 0.85;
          vertexColorMat.metalness = 0.05;
          wallMaterial = vertexColorMat;
        } else {
          // Create procedural material
          const materialConfig = getMaterialConfigForBuildingType(buildingType);
          materialRef.current = createBuildingMaterial({
            ...materialConfig,
            type: materialType,
          });
          wallMaterial = materialRef.current as THREE.Material;
        }

        // Add the main building mesh
        if (result.mesh instanceof THREE.Mesh) {
          result.mesh.material = wallMaterial;
          result.mesh.castShadow = true;
          result.mesh.receiveShadow = true;
          buildingGroup.add(result.mesh);
        } else if (result.mesh instanceof THREE.Group) {
          result.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              // Apply material based on name/type
              if (child.name.includes("glass") && showWindowGlass) {
                child.material = glassMaterialRef.current!;
                child.renderOrder = 1;
              } else if (
                child.name.includes("window") ||
                child.name.includes("door")
              ) {
                // Window frames and door trims use the wall material
                child.material = wallMaterial;
              } else {
                child.material = wallMaterial;
              }
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          buildingGroup.add(result.mesh);
        }

        // Handle geometryArrays if available for window glass
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
              glassMesh.renderOrder = 1; // Render after opaque
              buildingGroup.add(glassMesh);
            }
          }
        }

        // Interior lighting
        // Clean up old lights
        if (interiorLightsRef.current) {
          sceneRef.current.remove(interiorLightsRef.current);
          interiorLightsRef.current.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry?.dispose();
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((m) => m.dispose());
                } else {
                  child.material.dispose();
                }
              }
            }
          });
          interiorLightsRef.current = null;
        }

        // Remove old point lights
        for (const light of pointLightsRef.current) {
          sceneRef.current.remove(light);
        }
        pointLightsRef.current = [];

        if (enableInteriorLighting) {
          // Generate interior light positions
          const buildingPos = new THREE.Vector3(0, 0, 0);
          const interiorLights = generateInteriorLights(
            result.layout,
            buildingPos,
          );

          // Bake vertex lighting into building geometry
          buildingGroup.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry) {
              // Only bake lighting for interior surfaces (floors, walls)
              if (
                !child.name.includes("glass") &&
                !child.name.includes("roof")
              ) {
                bakeVertexLighting(child.geometry, interiorLights);
              }
            }
          });

          // Add visual light fixtures
          if (showLightFixtures && interiorLights.length > 0) {
            const fixtureGroup = new THREE.Group();
            fixtureGroup.name = "interior-lights";

            const fixtureMaterials = createFixtureMaterials();
            const sconceGeo = createWallSconceGeometry();
            const chandelierGeo = createChandelierGeometry(6);

            for (const light of interiorLights) {
              const geo =
                light.fixtureType === "chandelier" ? chandelierGeo : sconceGeo;
              const fixtureMesh = new THREE.Mesh(geo, fixtureMaterials.metal);
              fixtureMesh.position.copy(light.position);
              fixtureMesh.castShadow = true;
              fixtureGroup.add(fixtureMesh);

              // Add actual point light for dynamic effect
              const pointLight = new THREE.PointLight(
                light.color,
                light.intensity * 0.5, // Reduce since we also have baked lighting
                light.radius,
                2, // Decay
              );
              pointLight.position.copy(light.position);
              pointLight.castShadow = false; // Keep cheap
              sceneRef.current!.add(pointLight);
              pointLightsRef.current.push(pointLight);
            }

            sceneRef.current.add(fixtureGroup);
            interiorLightsRef.current = fixtureGroup;

            // Dispose temporary geometries
            sconceGeo.dispose();
            chandelierGeo.dispose();
          }
        }

        sceneRef.current.add(buildingGroup);
        currentBuildingRef.current = buildingGroup;
        currentLayoutRef.current = result.layout;
        setStats(result.stats);
        onGenerate?.(result.stats, buildingType, actualSeed);

        // Update navigation visualizer with new building
        if (navigationVisualizerRef.current) {
          navigationVisualizerRef.current.setBuilding(
            result.layout,
            { x: 0, y: 0, z: 0 },
            0,
          );
          const navStats = navigationVisualizerRef.current.getStats();
          onNavStatsUpdate?.(navStats);
        }
      }
    }, [
      buildingType,
      seed,
      includeRoof,
      materialType,
      showWindowGlass,
      showDoorTrims,
      enableInteriorLighting,
      showLightFixtures,
      onGenerate,
      onNavStatsUpdate,
    ]);

    // Generate initial building
    useEffect(() => {
      generateBuilding();
    }, [generateBuilding]);

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

    const buildingTypes = Object.keys(BUILDING_RECIPES);

    return (
      <div style={{ position: "relative", width, height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {showControls && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              background: "rgba(0,0,0,0.7)",
              padding: 12,
              borderRadius: 8,
              color: "white",
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Building Type
              </label>
              <select
                value={buildingType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setBuildingType(e.target.value)
                }
                style={{
                  width: "100%",
                  padding: 4,
                  borderRadius: 4,
                  border: "none",
                  background: "#333",
                  color: "white",
                }}
              >
                {buildingTypes.map((type) => (
                  <option key={type} value={type}>
                    {BUILDING_RECIPES[type].label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Seed (optional)
              </label>
              <input
                type="text"
                value={seed}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSeed(e.target.value)
                }
                placeholder="Random"
                style={{
                  width: "100%",
                  padding: 4,
                  borderRadius: 4,
                  border: "none",
                  background: "#333",
                  color: "white",
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", marginBottom: 4 }}>
                Material Style
              </label>
              <select
                value={materialType}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setMaterialType(
                    e.target.value as BuildingMaterialType | "vertex-colors",
                  )
                }
                style={{
                  width: "100%",
                  padding: 4,
                  borderRadius: 4,
                  border: "none",
                  background: "#333",
                  color: "white",
                }}
              >
                {MATERIAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={includeRoof}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setIncludeRoof(e.target.checked)
                  }
                />
                Include Roof
              </label>
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showWindowGlass}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShowWindowGlass(e.target.checked)
                  }
                />
                Window Glass
              </label>
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showDoorTrims}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShowDoorTrims(e.target.checked)
                  }
                />
                Door Trims
              </label>
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={enableInteriorLighting}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEnableInteriorLighting(e.target.checked)
                  }
                />
                Interior Lighting
              </label>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={showLightFixtures}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setShowLightFixtures(e.target.checked)
                  }
                  disabled={!enableInteriorLighting}
                />
                Show Light Fixtures (Sconces/Chandeliers)
              </label>
            </div>

            <button
              onClick={generateBuilding}
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 4,
                border: "none",
                background: "#4a9eff",
                color: "white",
                cursor: "pointer",
              }}
            >
              Generate
            </button>
          </div>
        )}

        {showStats && stats && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              background: "rgba(0,0,0,0.8)",
              padding: 12,
              borderRadius: 8,
              color: "white",
              fontSize: 11,
              minWidth: 160,
            }}
          >
            <div
              style={{
                fontWeight: "bold",
                marginBottom: 8,
                fontSize: 13,
                borderBottom: "1px solid #444",
                paddingBottom: 6,
              }}
            >
              Building Stats
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ color: "#aaa", fontSize: 10, marginBottom: 4 }}>
                STRUCTURE
              </div>
              <div>Rooms: {stats.rooms}</div>
              <div>Ground Cells: {stats.footprintCells}</div>
              {stats.upperFootprintCells > 0 && (
                <div>Upper Cells: {stats.upperFootprintCells}</div>
              )}
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ color: "#aaa", fontSize: 10, marginBottom: 4 }}>
                GEOMETRY
              </div>
              <div>Wall Segments: {stats.wallSegments}</div>
              <div>Floor Tiles: {stats.floorTiles}</div>
              <div>Roof Pieces: {stats.roofPieces}</div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ color: "#aaa", fontSize: 10, marginBottom: 4 }}>
                OPENINGS
              </div>
              <div>Doorways: {stats.doorways}</div>
              <div>Archways: {stats.archways}</div>
              <div>Windows: {stats.windows}</div>
            </div>

            <div>
              <div style={{ color: "#aaa", fontSize: 10, marginBottom: 4 }}>
                DETAILS
              </div>
              <div>Stairs: {stats.stairSteps} steps</div>
              <div>Props: {stats.props}</div>
            </div>

            {stats.optimization && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: "1px solid #333",
                }}
              >
                <div style={{ color: "#aaa", fontSize: 10, marginBottom: 4 }}>
                  OPTIMIZATION
                </div>
                <div>Merged Floors: {stats.optimization.mergedFloorRects}</div>
                <div>
                  Tri Reduction:{" "}
                  {stats.optimization.reductionPercent.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

BuildingViewer.displayName = "BuildingViewer";

export default BuildingViewer;
