import React, { useState } from "react";
import type { ClientWorld, PlayerStats } from "../../types";

interface SkillSelectModalProps {
  visible: boolean;
  world: ClientWorld;
  stats: PlayerStats | null;
  xpAmount: number;
  itemId: string;
  slot: number;
  onClose: () => void;
}

const SKILLS = [
  { key: "attack", label: "Attack", icon: "⚔️" },
  { key: "strength", label: "Strength", icon: "💪" },
  { key: "defense", label: "Defense", icon: "🛡️" },
  { key: "constitution", label: "Constitution", icon: "❤️" },
  { key: "ranged", label: "Ranged", icon: "🏹" },
  { key: "prayer", label: "Prayer", icon: "✨" },
  { key: "magic", label: "Magic", icon: "🔮" },
  { key: "woodcutting", label: "Woodcutting", icon: "🪓" },
  { key: "mining", label: "Mining", icon: "⛏️" },
  { key: "fishing", label: "Fishing", icon: "🎣" },
  { key: "firemaking", label: "Firemaking", icon: "🔥" },
  { key: "cooking", label: "Cooking", icon: "🍳" },
  { key: "smithing", label: "Smithing", icon: "🔨" },
  { key: "agility", label: "Agility", icon: "🏃" },
];

/**
 * SkillSelectModal - Modal for selecting a skill to apply XP to (e.g., from XP lamps)
 */
export function SkillSelectModal({
  visible,
  world,
  stats,
  xpAmount,
  itemId,
  slot,
  onClose,
}: SkillSelectModalProps) {
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  if (!visible) return null;

  const handleConfirm = () => {
    if (!selectedSkill) return;

    world.network?.send?.("useXpLamp", {
      itemId,
      slot,
      skill: selectedSkill,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 pointer-events-auto">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 max-w-md w-full mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Select a Skill</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* XP Amount */}
        <div className="text-center mb-4">
          <span className="text-amber-400 text-xl font-bold">
            +{xpAmount.toLocaleString()} XP
          </span>
        </div>

        {/* Skill Grid */}
        <div className="grid grid-cols-2 gap-2 mb-4 max-h-80 overflow-y-auto">
          {SKILLS.map((skill) => {
            const skillData =
              stats?.skills?.[skill.key as keyof typeof stats.skills];
            const level = skillData?.level ?? 1;
            const isSelected = selectedSkill === skill.key;

            return (
              <button
                key={skill.key}
                onClick={() => setSelectedSkill(skill.key)}
                className={`flex items-center gap-2 p-2 rounded border transition-colors ${
                  isSelected
                    ? "bg-amber-600/30 border-amber-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-gray-600"
                }`}
              >
                <span className="text-xl">{skill.icon}</span>
                <div className="text-left">
                  <div className="text-sm font-medium">{skill.label}</div>
                  <div className="text-xs text-gray-400">Level {level}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedSkill}
            className={`flex-1 py-2 px-4 rounded transition-colors ${
              selectedSkill
                ? "bg-amber-600 hover:bg-amber-500 text-white"
                : "bg-gray-600 text-gray-400 cursor-not-allowed"
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
