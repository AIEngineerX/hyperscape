/**
 * Duel System Error Messages
 *
 * Centralized error strings for the duel system.
 * Prevents typo drift and enables easy localization.
 */

export const DUEL_ERRORS = {
  // Challenge errors
  SELF_CHALLENGE: "You can't challenge yourself to a duel.",
  ALREADY_IN_DUEL: "You're already in a duel.",
  TARGET_IN_DUEL: "That player is already in a duel.",

  // Session lookup
  DUEL_NOT_FOUND: "Duel not found.",
  ALREADY_RESOLVING: "Duel is already being resolved.",

  // Participant checks
  NOT_PARTICIPANT: "You're not in this duel.",

  // State guards
  INVALID_STATE_RULES: "Cannot modify rules at this stage.",
  INVALID_STATE_EQUIPMENT:
    "Cannot modify equipment restrictions at this stage.",
  INVALID_STATE_ACCEPT_RULES: "Cannot accept rules at this stage.",
  INVALID_STATE_STAKES: "Cannot modify stakes at this stage.",
  INVALID_STATE_ACCEPT_STAKES: "Cannot accept stakes at this stage.",
  INVALID_STATE_CONFIRM: "Cannot confirm at this stage.",
  INVALID_STATE_COUNTDOWN: "Duel is not in countdown state.",

  // Stake validation
  INVALID_QUANTITY: "Invalid quantity.",
  MAX_STAKES_REACHED: "Maximum stakes reached.",
  ALREADY_STAKED: "Item from this slot is already staked.",
  INVALID_STAKE_INDEX: "Invalid stake index.",

  // Arena
  NO_ARENA_AVAILABLE: "No arena available. Please try again.",

  // Pending challenge guards
  ALREADY_HAS_OUTGOING: "You already have a pending challenge.",
  HAS_PENDING_INCOMING: "You have a pending challenge to respond to.",
  TARGET_HAS_OUTGOING: "That player already has a pending challenge.",
  TARGET_BEING_CHALLENGED: "That player is already being challenged.",
  CHALLENGE_COOLDOWN: "Please wait before challenging this player again.",

  // Challenge response
  CHALLENGE_NOT_FOUND_EXPIRED: "Challenge not found or expired.",
  CHALLENGE_NOT_FOUND: "Challenge not found.",

  // Forfeit
  NOT_IN_DUEL: "You're not in a duel.",
  DUEL_NOT_STARTED: "The duel has not started yet.",
  CANNOT_FORFEIT: "You cannot forfeit - this duel is to the death!",
} as const;
