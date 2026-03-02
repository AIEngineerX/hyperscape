/**
 * Object Pools
 *
 * Reusable object pools to eliminate allocations in hot paths.
 */

export { quaternionPool, type PooledQuaternion } from "./QuaternionPool";
export { tilePool, type PooledTile } from "./TilePool";
export {
  EntityPool,
  createPoolableWrapper,
  type PoolableEntity,
  type EntityPoolConfig,
  type PoolStats,
} from "./EntityPool";
export { positionPool, type PooledPosition } from "./PositionPool";
export {
  createEventPayloadPool,
  eventPayloadPoolRegistry,
  type EventPayloadPool,
  type EventPayloadPoolStats,
  type EventPayloadPoolConfig,
  type PooledPayload,
} from "./EventPayloadPool";
export {
  CombatEventPools,
  type PooledCombatDamageDealtPayload,
  type PooledCombatProjectileLaunchedPayload,
  type PooledCombatFaceTargetPayload,
  type PooledCombatClearFaceTargetPayload,
  type PooledCombatAttackFailedPayload,
  type PooledCombatFollowTargetPayload,
  type PooledCombatStartedPayload,
  type PooledCombatEndedPayload,
  type PooledCombatProjectileHitPayload,
  type PooledCombatKillPayload,
} from "./CombatEventPools";
