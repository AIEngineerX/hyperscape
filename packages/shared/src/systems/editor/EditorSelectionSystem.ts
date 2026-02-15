/**
 * Editor selection with click, shift-multi, and marquee selection.
 * Requires graphics renderer for mouse controls. Check isReady.
 */

import * as THREE from "three";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";

export interface Selectable {
  id: string;
  name: string;
  object3D: THREE.Object3D;
  type: string;
  userData?: Record<string, unknown>;
}

export interface SelectionChangeEvent {
  selected: Selectable[];
  added: Selectable[];
  removed: Selectable[];
  action: "select" | "deselect" | "toggle" | "clear" | "set";
}

export interface EditorSelectionConfig {
  enableMultiSelect: boolean;
  enableMarqueeSelect: boolean;
  highlightColor: number;
  highlightOpacity: number;
  enableOutline: boolean;
  maxSelection: number;
  selectableLayers: number;
  maxHistorySize: number;
}

/** Defaults for editor selection (highlight visible on varied backgrounds, reasonable batch sizes) */
const DEFAULT_CONFIG: EditorSelectionConfig = {
  enableMultiSelect: true,
  enableMarqueeSelect: true,
  highlightColor: 0x00aaff, // Cyan - visible on terrain/sky/buildings
  highlightOpacity: 0.3, // Semi-transparent to see object underneath
  enableOutline: true,
  maxSelection: 1000, // Supports batch operations on large areas
  selectableLayers: 1, // THREE.js layer for raycasting (0 = default, 1+ = custom)
  maxHistorySize: 50, // Undo/redo stack depth for selection changes
};

export class EditorSelectionSystem extends System {
  private config: EditorSelectionConfig;
  private selection: Map<string, Selectable> = new Map();
  private selectables: Map<string, Selectable> = new Map();
  private objectToSelectable: WeakMap<THREE.Object3D, Selectable> =
    new WeakMap();
  private domElement: HTMLElement | null = null;
  public isReady = false;

  private raycaster: THREE.Raycaster;
  private mouse = new THREE.Vector2();
  private _tempVec3 = new THREE.Vector3();

  private isMarqueeActive = false;
  private marqueeStart = new THREE.Vector2();
  private marqueeEnd = new THREE.Vector2();
  private marqueeDiv: HTMLDivElement | null = null;

  private selectionHistory: Array<Set<string>> = [];
  private historyIndex = -1;

  private highlightMaterial: THREE.MeshBasicMaterial;
  private highlightMeshes: Map<string, THREE.Mesh> = new Map();

  constructor(world: World, config: Partial<EditorSelectionConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(this.config.selectableLayers);

    // Create highlight material
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: this.config.highlightColor,
      transparent: true,
      opacity: this.config.highlightOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: ["editor-camera"],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);
    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn(
        "[EditorSelectionSystem] No renderer - mouse controls disabled",
      );
      this.emit("init-failed", {
        reason: "no-renderer",
        system: "editor-selection",
      });
      return;
    }
    this.domElement = graphics.renderer.domElement;
    this.setupEventListeners();
    this.createMarqueeElement();
    this.isReady = true;
    this.emit("ready", { system: "editor-selection" });
  }

  private setupEventListeners(): void {
    if (!this.domElement) return;
    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointermove", this.onPointerMove);
    this.domElement.addEventListener("pointerup", this.onPointerUp);
    this.domElement.addEventListener("keydown", this.onKeyDown);
  }

  private createMarqueeElement(): void {
    if (!this.domElement?.parentElement) return;
    this.marqueeDiv = document.createElement("div");
    this.marqueeDiv.style.cssText = `position:absolute;border:1px solid #00aaff;background:rgba(0,170,255,0.1);pointer-events:none;display:none;z-index:1000`;
    this.domElement.parentElement.appendChild(this.marqueeDiv);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return; // Left click only

    const rect = this.domElement!.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Check if we clicked on a selectable
    const hit = this.raycastSelectables();

    if (hit) {
      // Direct selection
      if (event.shiftKey && this.config.enableMultiSelect) {
        this.toggleSelection(hit);
      } else {
        this.setSelection([hit]);
      }
    } else if (this.config.enableMarqueeSelect) {
      // Start marquee selection
      this.startMarquee(event);
    } else if (!event.shiftKey) {
      // Clicked on nothing, clear selection
      this.clearSelection();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isMarqueeActive) return;
    this.updateMarquee(event);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    if (this.isMarqueeActive) {
      this.endMarquee(event);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const mod = event.ctrlKey || event.metaKey;
    switch (event.code) {
      case "Escape":
        this.clearSelection();
        break;
      case "KeyA":
        if (mod) {
          event.preventDefault();
          this.selectAll();
        }
        break;
      case "KeyZ":
        if (mod) {
          event.preventDefault();
          event.shiftKey ? this.redo() : this.undo();
        }
        break;
      case "Delete":
      case "Backspace":
        this.emit("delete-requested", { selected: this.getSelection() });
        break;
    }
  };

  private raycastSelectables(): Selectable | null {
    if (this.selectables.size === 0) return null;
    const objects = Array.from(this.selectables.values()).map(
      (s) => s.object3D,
    );
    this.raycaster.setFromCamera(this.mouse, this.world.camera);
    const intersects = this.raycaster.intersectObjects(objects, true);
    if (intersects.length === 0) return null;
    for (
      let obj: THREE.Object3D | null = intersects[0].object;
      obj;
      obj = obj.parent
    ) {
      const sel = this.objectToSelectable.get(obj);
      if (sel) return sel;
    }
    return null;
  }

  private startMarquee(event: PointerEvent): void {
    this.isMarqueeActive = true;
    const r = this.domElement!.getBoundingClientRect();
    this.marqueeStart.set(event.clientX - r.left, event.clientY - r.top);
    this.marqueeEnd.copy(this.marqueeStart);
    if (this.marqueeDiv) {
      this.marqueeDiv.style.display = "block";
      this.updateMarqueeElement();
    }
  }

  private updateMarquee(event: PointerEvent): void {
    const r = this.domElement!.getBoundingClientRect();
    this.marqueeEnd.set(event.clientX - r.left, event.clientY - r.top);
    this.updateMarqueeElement();
  }

  private updateMarqueeElement(): void {
    if (!this.marqueeDiv) return;
    const l = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const t = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const w = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
    const h = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);
    this.marqueeDiv.style.left = `${l}px`;
    this.marqueeDiv.style.top = `${t}px`;
    this.marqueeDiv.style.width = `${w}px`;
    this.marqueeDiv.style.height = `${h}px`;
  }

  private endMarquee(event: PointerEvent): void {
    this.isMarqueeActive = false;
    if (this.marqueeDiv) this.marqueeDiv.style.display = "none";
    const w = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
    const h = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);
    if (w < 5 && h < 5) {
      if (!event.shiftKey) this.clearSelection();
      return;
    }
    const selected = this.getObjectsInMarquee();
    if (event.shiftKey && this.config.enableMultiSelect) {
      for (const s of selected) this.addToSelection(s);
    } else {
      this.setSelection(selected);
    }
  }

  private getObjectsInMarquee(): Selectable[] {
    const result: Selectable[] = [];
    const r = this.domElement!.getBoundingClientRect();
    const minX =
      (Math.min(this.marqueeStart.x, this.marqueeEnd.x) / r.width) * 2 - 1;
    const maxX =
      (Math.max(this.marqueeStart.x, this.marqueeEnd.x) / r.width) * 2 - 1;
    const minY =
      -(Math.max(this.marqueeStart.y, this.marqueeEnd.y) / r.height) * 2 + 1;
    const maxY =
      -(Math.min(this.marqueeStart.y, this.marqueeEnd.y) / r.height) * 2 + 1;
    for (const sel of this.selectables.values()) {
      sel.object3D.getWorldPosition(this._tempVec3);
      this._tempVec3.project(this.world.camera);
      const { x, y, z } = this._tempVec3;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY && z >= -1 && z <= 1)
        result.push(sel);
    }
    return result;
  }

  registerSelectable(selectable: Selectable): void {
    this.selectables.set(selectable.id, selectable);
    this.objectToSelectable.set(selectable.object3D, selectable);
    selectable.object3D.layers.enable(this.config.selectableLayers);
  }

  unregisterSelectable(id: string): void {
    const sel = this.selectables.get(id);
    if (!sel) return;
    if (this.selection.has(id)) this.removeFromSelection(sel);
    this.selectables.delete(id);
    this.objectToSelectable.delete(sel.object3D);
  }

  setSelection(selectables: Selectable[]): void {
    const oldSel = new Set(this.selection.keys());
    const newSel = new Set(selectables.map((s) => s.id));
    const added: Selectable[] = [];
    const removed: Selectable[] = [];

    for (const id of oldSel) {
      if (!newSel.has(id)) {
        const s = this.selectables.get(id);
        if (s) removed.push(s);
      }
    }
    for (const s of selectables) {
      if (!oldSel.has(s.id)) added.push(s);
    }

    this.selection.clear();
    for (const s of selectables) {
      if (this.selection.size < this.config.maxSelection)
        this.selection.set(s.id, s);
    }
    this.updateSelectionVisuals(added, removed);
    this.saveToHistory();
    this.emit("selection-changed", {
      selected: this.getSelection(),
      added,
      removed,
      action: "set",
    } as SelectionChangeEvent);
  }

  addToSelection(selectable: Selectable | Selectable[]): void {
    const items = Array.isArray(selectable) ? selectable : [selectable];
    const added: Selectable[] = [];
    for (const item of items) {
      if (
        !this.selection.has(item.id) &&
        this.selection.size < this.config.maxSelection
      ) {
        this.selection.set(item.id, item);
        added.push(item);
      }
    }
    if (added.length > 0) {
      this.updateSelectionVisuals(added, []);
      this.saveToHistory();
      this.emit("selection-changed", {
        selected: this.getSelection(),
        added,
        removed: [],
        action: "select",
      } as SelectionChangeEvent);
    }
  }

  removeFromSelection(selectable: Selectable | Selectable[]): void {
    const items = Array.isArray(selectable) ? selectable : [selectable];
    const removed: Selectable[] = [];
    for (const item of items) {
      if (this.selection.has(item.id)) {
        this.selection.delete(item.id);
        removed.push(item);
      }
    }
    if (removed.length > 0) {
      this.updateSelectionVisuals([], removed);
      this.saveToHistory();
      this.emit("selection-changed", {
        selected: this.getSelection(),
        added: [],
        removed,
        action: "deselect",
      } as SelectionChangeEvent);
    }
  }

  toggleSelection(selectable: Selectable): void {
    this.selection.has(selectable.id)
      ? this.removeFromSelection(selectable)
      : this.addToSelection(selectable);
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    const removed = this.getSelection();
    this.selection.clear();
    this.updateSelectionVisuals([], removed);
    this.saveToHistory();
    this.emit("selection-changed", {
      selected: [],
      added: [],
      removed,
      action: "clear",
    } as SelectionChangeEvent);
  }

  selectAll(): void {
    this.setSelection(
      Array.from(this.selectables.values()).slice(0, this.config.maxSelection),
    );
  }

  getSelection(): Selectable[] {
    return Array.from(this.selection.values());
  }
  isSelected(id: string): boolean {
    return this.selection.has(id);
  }
  getSelectionCount(): number {
    return this.selection.size;
  }

  getSelectionBounds(): THREE.Box3 | null {
    if (this.selection.size === 0) return null;
    const box = new THREE.Box3();
    let first = true;
    for (const sel of this.selection.values()) {
      const b = new THREE.Box3().setFromObject(sel.object3D);
      first ? (box.copy(b), (first = false)) : box.union(b);
    }
    return box;
  }

  undo(): boolean {
    if (this.historyIndex <= 0) return false;
    this.restoreSelectionState(this.selectionHistory[--this.historyIndex]);
    return true;
  }

  redo(): boolean {
    if (this.historyIndex >= this.selectionHistory.length - 1) return false;
    this.restoreSelectionState(this.selectionHistory[++this.historyIndex]);
    return true;
  }

  private saveToHistory(): void {
    this.selectionHistory = this.selectionHistory.slice(
      0,
      this.historyIndex + 1,
    );
    this.selectionHistory.push(new Set(this.selection.keys()));
    this.historyIndex = this.selectionHistory.length - 1;
    if (this.selectionHistory.length > this.config.maxHistorySize) {
      this.selectionHistory.shift();
      this.historyIndex--;
    }
  }

  private restoreSelectionState(state: Set<string>): void {
    const old = new Set(this.selection.keys());
    const added: Selectable[] = [],
      removed: Selectable[] = [];
    for (const id of old) {
      if (!state.has(id)) {
        const s = this.selectables.get(id);
        if (s) removed.push(s);
      }
    }
    for (const id of state) {
      if (!old.has(id)) {
        const s = this.selectables.get(id);
        if (s) added.push(s);
      }
    }
    this.selection.clear();
    for (const id of state) {
      const s = this.selectables.get(id);
      if (s) this.selection.set(id, s);
    }
    this.updateSelectionVisuals(added, removed);
  }

  private updateSelectionVisuals(
    added: Selectable[],
    removed: Selectable[],
  ): void {
    for (const s of removed) this.removeHighlight(s);
    for (const s of added) this.addHighlight(s);
  }

  private addHighlight(selectable: Selectable): void {
    if (!this.config.enableOutline || this.highlightMeshes.has(selectable.id))
      return;
    const box = new THREE.Box3().setFromObject(selectable.object3D);
    const size = new THREE.Vector3();
    box.getSize(size).multiplyScalar(1.02);
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geo, this.highlightMaterial);
    box.getCenter(mesh.position);
    this.world.stage.scene.add(mesh);
    this.highlightMeshes.set(selectable.id, mesh);
  }

  private removeHighlight(selectable: Selectable): void {
    const mesh = this.highlightMeshes.get(selectable.id);
    if (!mesh) return;
    this.world.stage.scene.remove(mesh);
    mesh.geometry.dispose();
    this.highlightMeshes.delete(selectable.id);
  }

  override destroy(): void {
    if (this.domElement) {
      this.domElement.removeEventListener("pointerdown", this.onPointerDown);
      this.domElement.removeEventListener("pointermove", this.onPointerMove);
      this.domElement.removeEventListener("pointerup", this.onPointerUp);
      this.domElement.removeEventListener("keydown", this.onKeyDown);
    }
    this.marqueeDiv?.parentElement?.removeChild(this.marqueeDiv);
    for (const mesh of this.highlightMeshes.values()) {
      this.world.stage.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.highlightMeshes.clear();
    this.highlightMaterial.dispose();
    this.selection.clear();
    this.selectables.clear();
    this.selectionHistory.length = 0;
    super.destroy();
  }
}
