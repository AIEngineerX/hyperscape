/**
 * Quest Selection Store
 *
 * Manages the currently selected quest for the quest detail panel.
 * Used to communicate between QuestsPanel (list) and QuestDetailPanel (detail view).
 *
 * Also tracks quest statuses for minimap quest icons (available/active/completed).
 */

import { create } from "zustand";
import type { Quest, QuestState } from "@/game/systems/quest";

/** Quest selection store state and actions */
export interface QuestSelectionState {
  /** The currently selected quest (null if none) */
  selectedQuest: Quest | null;
  /** Set the selected quest */
  setSelectedQuest: (quest: Quest | null) => void;
  /** Clear the selected quest */
  clearSelectedQuest: () => void;
  /** Quest status map: questId → QuestState ("available" | "active" | "completed") */
  questStatuses: Map<string, QuestState>;
  /** Update quest statuses from server quest list */
  setQuestStatuses: (quests: Array<{ id: string; state: QuestState }>) => void;
}

/**
 * Zustand store for quest selection state
 *
 * This store is used to share the selected quest between the quest list
 * and the quest detail panel, which may be in separate windows.
 */
export const useQuestSelectionStore = create<QuestSelectionState>((set) => ({
  selectedQuest: null,
  setSelectedQuest: (quest) => set({ selectedQuest: quest }),
  clearSelectedQuest: () => set({ selectedQuest: null }),
  questStatuses: new Map(),
  setQuestStatuses: (quests) => {
    const map = new Map<string, QuestState>();
    for (const q of quests) {
      map.set(q.id, q.state);
    }
    set({ questStatuses: map });
  },
}));
