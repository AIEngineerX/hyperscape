/**
 * Editor transform gizmos (translate/rotate/scale).
 * Requires graphics renderer. Check isReady.
 */

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";
import type {
  EditorSelectionSystem,
  Selectable,
  SelectionChangeEvent,
} from "./EditorSelectionSystem";

export type TransformMode = "translate" | "rotate" | "scale";
export type TransformSpace = "world" | "local";

export interface TransformEvent {
  object: THREE.Object3D;
  selectable: Selectable | null;
  mode: TransformMode;
  transforming: boolean;
}

export interface EditorGizmoConfig {
  initialMode: TransformMode;
  initialSpace: TransformSpace;
  size: number;
  enableSnap: boolean;
  translationSnap: number;
  rotationSnap: number;
  scaleSnap: number;
  showAlways: boolean;
}

/** Defaults for transform gizmos (snap values match common grid/angle increments) */
const DEFAULT_CONFIG: EditorGizmoConfig = {
  initialMode: "translate",
  initialSpace: "world", // World space for consistent orientation
  size: 1, // Gizmo visual scale (1 = default THREE.js size)
  enableSnap: false, // Off by default, toggle with X key
  translationSnap: 1, // 1 unit grid for terrain alignment
  rotationSnap: 15, // 15° = common angles (90/6), easy mental math
  scaleSnap: 0.1, // 10% increments for proportional scaling
  showAlways: false,
};

export class EditorGizmoSystem extends System {
  private config: EditorGizmoConfig;
  private transformControls: TransformControls | null = null;
  private mode: TransformMode = "translate";
  private space: TransformSpace = "world";
  private domElement: HTMLElement | null = null;
  private selectionSystem: EditorSelectionSystem | null = null;
  public isReady = false;

  private transformGroup: THREE.Group;
  private transformGroupCenter = new THREE.Vector3();
  private originalTransforms = new Map<
    string,
    {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
    }
  >();

  private currentSelectable: Selectable | null = null;
  private isTransforming = false;
  private snapEnabled = false;

  constructor(world: World, config: Partial<EditorGizmoConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.initialMode;
    this.space = this.config.initialSpace;
    this.snapEnabled = this.config.enableSnap;

    // Create transform group for multi-selection
    this.transformGroup = new THREE.Group();
    this.transformGroup.name = "editor-transform-group";
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: ["editor-selection", "editor-camera"],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);
    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn(
        "[EditorGizmoSystem] No renderer - transform controls disabled",
      );
      this.emit("init-failed", {
        reason: "no-renderer",
        system: "editor-gizmo",
      });
      return;
    }
    this.domElement = graphics.renderer.domElement;
    this.setupTransformControls();
    this.setupKeyboardShortcuts();
    this.selectionSystem =
      (this.world.getSystem("editor-selection") as
        | EditorSelectionSystem
        | undefined) ?? null;
    if (this.selectionSystem)
      this.selectionSystem.on("selection-changed", this.onSelectionChanged);
    this.isReady = true;
    this.emit("ready", { system: "editor-gizmo" });
  }

  private setupTransformControls(): void {
    if (!this.domElement) return;
    this.transformControls = new TransformControls(
      this.world.camera,
      this.domElement,
    );
    this.transformControls.setMode(this.mode);
    this.transformControls.setSpace(this.space);
    this.transformControls.setSize(this.config.size);
    this.world.stage.scene.add(this.transformControls);
    this.transformControls.addEventListener(
      "dragging-changed",
      this.onDraggingChanged as unknown as (event: THREE.Event) => void,
    );
    this.transformControls.addEventListener(
      "objectChange",
      this.onObjectChange,
    );
    (this.transformControls as unknown as THREE.Object3D).visible = false;
    this.transformControls.enabled = false;
  }

  private setupKeyboardShortcuts(): void {
    if (!this.domElement) return;
    this.domElement.addEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const noMod = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    switch (event.code) {
      case "KeyW":
        if (noMod) this.setMode("translate");
        break;
      case "KeyE":
        if (noMod) this.setMode("rotate");
        break;
      case "KeyR":
        if (noMod) this.setMode("scale");
        break;
      case "KeyX":
        if (!event.ctrlKey && !event.metaKey) this.toggleSnap();
        break;
      case "KeyG":
        if (!event.ctrlKey && !event.metaKey) this.toggleSpace();
        break;
    }
  };

  private onSelectionChanged = (event: SelectionChangeEvent): void => {
    const { selected } = event;
    if (selected.length === 0) this.detachGizmo();
    else if (selected.length === 1) this.attachToObject(selected[0]);
    else this.attachToMultiSelection(selected);
  };

  private onDraggingChanged = (event: { value: boolean }): void => {
    this.isTransforming = event.value;
    const camSys = this.world.getSystem("editor-camera") as
      | { getControls?: () => { enabled: boolean } | null }
      | undefined;
    const ctl = camSys?.getControls?.();
    if (ctl) ctl.enabled = !event.value;

    if (event.value) {
      this.saveOriginalTransforms();
      this.emit("transform-start", this.createTransformEvent());
    } else {
      this.emit("transform-end", this.createTransformEvent());
      if (this.selectionSystem && this.selectionSystem.getSelectionCount() > 1)
        this.applyGroupTransformToSelection();
    }
  };

  private onObjectChange = (): void => {
    if (!this.isTransforming) return;
    this.emit("transform-change", this.createTransformEvent());
    if (this.selectionSystem && this.selectionSystem.getSelectionCount() > 1)
      this.updateMultiSelectionTransforms();
  };

  private createTransformEvent(): TransformEvent {
    return {
      object: this.transformControls?.object ?? this.transformGroup,
      selectable: this.currentSelectable,
      mode: this.mode,
      transforming: this.isTransforming,
    };
  }

  private saveOriginalTransforms(): void {
    this.originalTransforms.clear();
    if (!this.selectionSystem) return;
    for (const s of this.selectionSystem.getSelection()) {
      this.originalTransforms.set(s.id, {
        position: s.object3D.position.clone(),
        quaternion: s.object3D.quaternion.clone(),
        scale: s.object3D.scale.clone(),
      });
    }
  }

  private setControlsVisible(visible: boolean): void {
    if (this.transformControls)
      (this.transformControls as unknown as THREE.Object3D).visible = visible;
  }

  private attachToObject(selectable: Selectable): void {
    if (!this.transformControls) return;
    this.currentSelectable = selectable;
    this.transformControls.attach(selectable.object3D);
    this.setControlsVisible(true);
    this.transformControls.enabled = true;
    this.emit("gizmo-attached", { selectable });
  }

  private attachToMultiSelection(selection: Selectable[]): void {
    if (!this.transformControls) return;
    this.transformGroupCenter.set(0, 0, 0);
    for (const s of selection) {
      const wp = new THREE.Vector3();
      s.object3D.getWorldPosition(wp);
      this.transformGroupCenter.add(wp);
    }
    this.transformGroupCenter.divideScalar(selection.length);
    this.transformGroup.position.copy(this.transformGroupCenter);
    this.transformGroup.rotation.set(0, 0, 0);
    this.transformGroup.scale.set(1, 1, 1);
    if (!this.transformGroup.parent)
      this.world.stage.scene.add(this.transformGroup);
    this.currentSelectable = null;
    this.transformControls.attach(this.transformGroup);
    this.setControlsVisible(true);
    this.transformControls.enabled = true;
    this.emit("gizmo-attached", { selection });
  }

  private updateMultiSelectionTransforms(): void {
    if (!this.selectionSystem) return;
    const gp = this.transformGroup.position,
      gr = this.transformGroup.quaternion,
      gs = this.transformGroup.scale;
    for (const s of this.selectionSystem.getSelection()) {
      const orig = this.originalTransforms.get(s.id);
      if (!orig) continue;
      const offset = orig.position.clone().sub(this.transformGroupCenter);
      switch (this.mode) {
        case "translate":
          s.object3D.position.copy(
            orig.position.clone().add(gp).sub(this.transformGroupCenter),
          );
          break;
        case "rotate":
          offset.applyQuaternion(gr);
          s.object3D.position.copy(this.transformGroupCenter).add(offset);
          s.object3D.quaternion.copy(orig.quaternion).premultiply(gr);
          break;
        case "scale":
          offset.multiply(gs);
          s.object3D.position.copy(this.transformGroupCenter).add(offset);
          s.object3D.scale.copy(orig.scale).multiply(gs);
          break;
      }
    }
  }

  private applyGroupTransformToSelection(): void {
    this.transformGroup.position.set(0, 0, 0);
    this.transformGroup.rotation.set(0, 0, 0);
    this.transformGroup.scale.set(1, 1, 1);
    if (!this.selectionSystem) return;
    const selection = this.selectionSystem.getSelection();
    if (selection.length > 1) {
      this.transformGroupCenter.set(0, 0, 0);
      for (const s of selection) {
        const wp = new THREE.Vector3();
        s.object3D.getWorldPosition(wp);
        this.transformGroupCenter.add(wp);
      }
      this.transformGroupCenter.divideScalar(selection.length);
      this.transformGroup.position.copy(this.transformGroupCenter);
    }
  }

  private detachGizmo(): void {
    if (!this.transformControls) return;
    this.transformControls.detach();
    this.setControlsVisible(false);
    this.transformControls.enabled = false;
    this.currentSelectable = null;
    if (this.transformGroup.parent)
      this.world.stage.scene.remove(this.transformGroup);
    this.emit("gizmo-detached", {});
  }

  setMode(mode: TransformMode): void {
    this.mode = mode;
    this.transformControls?.setMode(mode);
    this.emit("mode-changed", { mode });
  }
  getMode(): TransformMode {
    return this.mode;
  }
  setSpace(space: TransformSpace): void {
    this.space = space;
    this.transformControls?.setSpace(space);
    this.emit("space-changed", { space });
  }
  getSpace(): TransformSpace {
    return this.space;
  }
  toggleSpace(): void {
    this.setSpace(this.space === "world" ? "local" : "world");
  }
  setSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.updateSnapSettings();
    this.emit("snap-changed", { enabled });
  }
  toggleSnap(): void {
    this.setSnap(!this.snapEnabled);
  }
  isSnapEnabled(): boolean {
    return this.snapEnabled;
  }

  setSnapIncrements(
    translation?: number,
    rotation?: number,
    scale?: number,
  ): void {
    if (translation !== undefined) this.config.translationSnap = translation;
    if (rotation !== undefined) this.config.rotationSnap = rotation;
    if (scale !== undefined) this.config.scaleSnap = scale;
    this.updateSnapSettings();
  }

  private updateSnapSettings(): void {
    if (!this.transformControls) return;
    if (this.snapEnabled) {
      this.transformControls.setTranslationSnap(this.config.translationSnap);
      this.transformControls.setRotationSnap(
        THREE.MathUtils.degToRad(this.config.rotationSnap),
      );
      this.transformControls.setScaleSnap(this.config.scaleSnap);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  setSize(size: number): void {
    this.config.size = size;
    this.transformControls?.setSize(size);
  }
  isCurrentlyTransforming(): boolean {
    return this.isTransforming;
  }
  getControls(): TransformControls | null {
    return this.transformControls;
  }

  override destroy(): void {
    this.domElement?.removeEventListener("keydown", this.onKeyDown);
    this.selectionSystem?.off("selection-changed", this.onSelectionChanged);
    if (this.transformControls) {
      this.transformControls.removeEventListener(
        "dragging-changed",
        this.onDraggingChanged as unknown as (event: THREE.Event) => void,
      );
      this.transformControls.removeEventListener(
        "objectChange",
        this.onObjectChange,
      );
      this.transformControls.detach();
      this.world.stage.scene.remove(this.transformControls);
      this.transformControls.dispose();
      this.transformControls = null;
    }
    if (this.transformGroup.parent)
      this.world.stage.scene.remove(this.transformGroup);
    this.originalTransforms.clear();
    super.destroy();
  }
}
