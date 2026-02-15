/**
 * High-Performance Priority Queue for Edge Decimation
 *
 * Uses a binary min-heap backed by typed arrays for cache efficiency.
 * Supports efficient update operations via an index map.
 */

import { INF } from "./types.js";

/**
 * Priority queue for edge collapse ordering.
 *
 * Features:
 * - O(log n) insert, extract-min, update, remove
 * - Cache-friendly typed array storage
 * - Direct edge index mapping for fast updates
 */
export class EdgePriorityQueue {
  /** Edge costs (parallel to edges array) */
  private costs: Float64Array;

  /** Edge indices in heap order */
  private heap: Uint32Array;

  /** Maps edge index to heap position (-1 if not in heap) */
  private heapPosition: Int32Array;

  /** Current heap size */
  private heapSize: number;

  /** Maximum number of edges */
  private maxEdges: number;

  /**
   * Create a new priority queue
   * @param maxEdges Maximum number of edges
   */
  constructor(maxEdges: number) {
    this.maxEdges = maxEdges;
    this.costs = new Float64Array(maxEdges);
    this.heap = new Uint32Array(maxEdges);
    this.heapPosition = new Int32Array(maxEdges);
    this.heapPosition.fill(-1);
    this.heapSize = 0;

    // Initialize costs to infinity
    this.costs.fill(INF);
  }

  /**
   * Insert an edge with given cost
   */
  insert(edgeIndex: number, cost: number): void {
    this.costs[edgeIndex] = cost;

    // If already in heap, update instead
    if (this.heapPosition[edgeIndex] >= 0) {
      this.updateInternal(edgeIndex);
      return;
    }

    // Add to end of heap
    const pos = this.heapSize++;
    this.heap[pos] = edgeIndex;
    this.heapPosition[edgeIndex] = pos;

    // Bubble up
    this.bubbleUp(pos);
  }

  /**
   * Peek at minimum cost edge without removing
   * @returns [edgeIndex, cost] or null if empty
   */
  peekMin(): [number, number] | null {
    if (this.heapSize === 0) return null;
    const ei = this.heap[0];
    return [ei, this.costs[ei]];
  }

  /**
   * Extract minimum cost edge
   * @returns [edgeIndex, cost] or null if empty
   */
  extractMin(): [number, number] | null {
    if (this.heapSize === 0) return null;

    const minEdge = this.heap[0];
    const minCost = this.costs[minEdge];
    this.heapPosition[minEdge] = -1;

    // Move last element to root
    this.heapSize--;
    if (this.heapSize > 0) {
      const lastEdge = this.heap[this.heapSize];
      this.heap[0] = lastEdge;
      this.heapPosition[lastEdge] = 0;

      // Bubble down
      this.bubbleDown(0);
    }

    return [minEdge, minCost];
  }

  /**
   * Update cost for an edge (must already be in queue)
   */
  update(edgeIndex: number, newCost: number): void {
    const oldCost = this.costs[edgeIndex];
    this.costs[edgeIndex] = newCost;

    const pos = this.heapPosition[edgeIndex];
    if (pos < 0) {
      // Not in queue - insert it
      this.insert(edgeIndex, newCost);
      return;
    }

    if (newCost < oldCost) {
      this.bubbleUp(pos);
    } else {
      this.bubbleDown(pos);
    }
  }

  /**
   * Remove an edge from the queue
   */
  remove(edgeIndex: number): void {
    const pos = this.heapPosition[edgeIndex];
    if (pos < 0) return;

    this.heapPosition[edgeIndex] = -1;

    // If it's the last element, just decrease size
    this.heapSize--;
    if (pos === this.heapSize) return;

    // Replace with last element
    const lastEdge = this.heap[this.heapSize];
    this.heap[pos] = lastEdge;
    this.heapPosition[lastEdge] = pos;

    // Restore heap property
    this.bubbleUp(pos);
    this.bubbleDown(this.heapPosition[lastEdge]);
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.heapSize === 0;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.heapSize;
  }

  /**
   * Get cost for an edge
   */
  getCost(edgeIndex: number): number {
    return this.costs[edgeIndex];
  }

  /**
   * Set cost without updating heap (for bulk initialization)
   */
  setCostDirect(edgeIndex: number, cost: number): void {
    this.costs[edgeIndex] = cost;
  }

  /**
   * Check if edge is in queue
   */
  contains(edgeIndex: number): boolean {
    return this.heapPosition[edgeIndex] >= 0;
  }

  /**
   * Build heap from all edges that have been set with setCostDirect
   * Call this after bulk initialization for efficiency
   */
  buildHeap(edgeCount: number): void {
    // Add all edges to heap
    this.heapSize = edgeCount;
    for (let i = 0; i < edgeCount; i++) {
      this.heap[i] = i;
      this.heapPosition[i] = i;
    }

    // Heapify from bottom up
    for (let i = Math.floor(edgeCount / 2) - 1; i >= 0; i--) {
      this.bubbleDown(i);
    }
  }

  /**
   * Update position after cost change
   */
  private updateInternal(edgeIndex: number): void {
    const pos = this.heapPosition[edgeIndex];
    if (pos >= 0) {
      this.bubbleUp(pos);
      this.bubbleDown(this.heapPosition[edgeIndex]);
    }
  }

  /**
   * Bubble element up to restore heap property
   */
  private bubbleUp(pos: number): void {
    const edge = this.heap[pos];
    const cost = this.costs[edge];

    while (pos > 0) {
      const parentPos = (pos - 1) >> 1;
      const parentEdge = this.heap[parentPos];
      const parentCost = this.costs[parentEdge];

      if (cost >= parentCost) break;

      // Swap with parent
      this.heap[pos] = parentEdge;
      this.heapPosition[parentEdge] = pos;
      pos = parentPos;
    }

    this.heap[pos] = edge;
    this.heapPosition[edge] = pos;
  }

  /**
   * Bubble element down to restore heap property
   */
  private bubbleDown(pos: number): void {
    const edge = this.heap[pos];
    const cost = this.costs[edge];
    const halfSize = this.heapSize >> 1;

    while (pos < halfSize) {
      let smallestPos = pos;
      let smallestCost = cost;

      const leftPos = (pos << 1) + 1;
      const rightPos = leftPos + 1;

      if (leftPos < this.heapSize) {
        const leftEdge = this.heap[leftPos];
        const leftCost = this.costs[leftEdge];
        if (leftCost < smallestCost) {
          smallestPos = leftPos;
          smallestCost = leftCost;
        }
      }

      if (rightPos < this.heapSize) {
        const rightEdge = this.heap[rightPos];
        const rightCost = this.costs[rightEdge];
        if (rightCost < smallestCost) {
          smallestPos = rightPos;
        }
      }

      if (smallestPos === pos) break;

      // Swap with smallest child
      const swapEdge = this.heap[smallestPos];
      this.heap[pos] = swapEdge;
      this.heapPosition[swapEdge] = pos;
      pos = smallestPos;
    }

    this.heap[pos] = edge;
    this.heapPosition[edge] = pos;
  }
}
