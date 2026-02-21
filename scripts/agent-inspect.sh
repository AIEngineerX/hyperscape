#!/usr/bin/env bash
#
# agent-inspect.sh — Deep inspection of a single agent
#
# Dumps everything: identity, skills, XP, equipment, inventory,
# quest progress, quest history, coins, health, position, deaths.
#
# Usage:
#   ./scripts/agent-inspect.sh rev
#   ./scripts/agent-inspect.sh "GPT-5"
#   ./scripts/agent-inspect.sh "Llama 3.3 70B"
#   DATABASE_URL="postgresql://..." ./scripts/agent-inspect.sh rev
#

set -euo pipefail

AGENT_NAME="${1:-}"

if [[ -z "$AGENT_NAME" ]]; then
  echo "Usage: $0 <agent-name>"
  echo ""
  echo "Examples:"
  echo "  $0 rev"
  echo "  $0 GPT-5"
  echo "  $0 \"Llama 3.3 70B\""
  echo ""
  echo "Available agents:"
  # Try to list agents
  if [[ -n "${DATABASE_URL:-}" ]]; then
    DB_URL="$DATABASE_URL"
  elif [[ -f "packages/server/.env" ]]; then
    DB_URL=$(grep '^DATABASE_URL=' packages/server/.env | head -1 | cut -d'=' -f2-)
  else
    echo "  (set DATABASE_URL to list)"
    exit 1
  fi
  export PGPASSWORD
  PGPASSWORD=$(echo "$DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
  psql "$DB_URL" -t -c "SELECT '  - ' || name FROM characters WHERE \"isAgent\" = 1 ORDER BY name;" 2>/dev/null
  exit 1
fi

# ─── Resolve DATABASE_URL ─────────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_URL="$DATABASE_URL"
elif [[ -f "packages/server/.env" ]]; then
  DB_URL=$(grep '^DATABASE_URL=' packages/server/.env | head -1 | cut -d'=' -f2-)
elif [[ -f ".env" ]]; then
  DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d'=' -f2-)
else
  echo "ERROR: No DATABASE_URL found."
  exit 1
fi

export PGPASSWORD
PGPASSWORD=$(echo "$DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

sql() {
  psql "$DB_URL" -c "$1" 2>/dev/null
}

sqlt() {
  psql "$DB_URL" -t -A -c "$1" 2>/dev/null
}

# ─── Find agent ───────────────────────────────────────────────────────────────
AGENT_ID=$(sqlt "SELECT id FROM characters WHERE name = '$AGENT_NAME' AND \"isAgent\" = 1 LIMIT 1;")

if [[ -z "$AGENT_ID" ]]; then
  # Try case-insensitive partial match
  AGENT_ID=$(sqlt "SELECT id FROM characters WHERE lower(name) LIKE lower('%${AGENT_NAME}%') AND \"isAgent\" = 1 LIMIT 1;")
fi

if [[ -z "$AGENT_ID" ]]; then
  echo "ERROR: Agent '$AGENT_NAME' not found."
  echo ""
  echo "Available agents:"
  sqlt "SELECT '  - ' || name || ' (' || id || ')' FROM characters WHERE \"isAgent\" = 1 ORDER BY name;"
  exit 1
fi

AGENT_DISPLAY=$(sqlt "SELECT name FROM characters WHERE id = '$AGENT_ID';")

B="\033[1m"
D="\033[2m"
C="\033[36m"
G="\033[32m"
Y="\033[33m"
R="\033[31m"
M="\033[35m"
N="\033[0m"

echo ""
echo -e "${B}╔══════════════════════════════════════════════════════════════╗${N}"
echo -e "${B}║  🔍  AGENT INSPECTION: ${C}${AGENT_DISPLAY}${N}"
echo -e "${B}║  ID: ${D}${AGENT_ID}${N}"
echo -e "${B}║  $(date '+%Y-%m-%d %H:%M:%S %Z')${N}"
echo -e "${B}╚══════════════════════════════════════════════════════════════╝${N}"

# ─── Identity ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${B}━━━ IDENTITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
sql "
SELECT
  name AS \"Name\",
  id AS \"Character ID\",
  \"accountId\" AS \"Account\",
  coins AS \"Coins\",
  \"questPoints\" AS \"Quest Points\",
  to_char(to_timestamp(\"createdAt\" / 1000.0), 'YYYY-MM-DD HH24:MI') AS \"Created\",
  to_char(to_timestamp(\"lastLogin\" / 1000.0), 'YYYY-MM-DD HH24:MI') AS \"Last Login\"
FROM characters WHERE id = '$AGENT_ID';
"

# ─── Health & Position ────────────────────────────────────────────────────────
echo -e "${B}━━━ HEALTH & POSITION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
sql "
SELECT
  health || '/' || \"maxHealth\" AS \"HP\",
  CASE WHEN health < \"maxHealth\" * 0.3 THEN '🔴 CRITICAL'
       WHEN health < \"maxHealth\" * 0.7 THEN '🟡 WOUNDED'
       ELSE '🟢 HEALTHY' END AS \"Status\",
  '(' || round(\"positionX\"::numeric, 1) || ', ' ||
  round(\"positionY\"::numeric, 1) || ', ' ||
  round(\"positionZ\"::numeric, 1) || ')' AS \"World Position\",
  CASE
    WHEN \"positionX\" BETWEEN -50 AND 50 AND \"positionZ\" BETWEEN -50 AND 50 THEN 'Spawn Area'
    WHEN \"positionX\" BETWEEN 60 AND 130 AND \"positionZ\" BETWEEN 50 AND 80 THEN 'Duel Lobby'
    WHEN \"positionX\" BETWEEN 60 AND 110 AND \"positionZ\" BETWEEN 85 AND 160 THEN 'Duel Arena'
    ELSE 'Wilderness'
  END AS \"Zone\"
FROM characters WHERE id = '$AGENT_ID';
"

# ─── Combat Skills ────────────────────────────────────────────────────────────
echo -e "${B}━━━ COMBAT SKILLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
sql "
SELECT
  '⚔️  Attack' AS \"Skill\", \"attackLevel\" AS \"Level\", \"attackXp\" AS \"XP\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '💪 Strength', \"strengthLevel\", \"strengthXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🛡️  Defense', \"defenseLevel\", \"defenseXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '❤️  Constitution', \"constitutionLevel\", \"constitutionXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🏹 Ranged', \"rangedLevel\", \"rangedXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🔮 Magic', \"magicLevel\", \"magicXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🙏 Prayer', \"prayerLevel\", \"prayerXp\"
  FROM characters WHERE id = '$AGENT_ID';
"

# ─── Gathering & Production Skills ────────────────────────────────────────────
echo -e "${B}━━━ GATHERING & PRODUCTION SKILLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
sql "
SELECT
  '🪓 Woodcutting' AS \"Skill\", \"woodcuttingLevel\" AS \"Level\", \"woodcuttingXp\" AS \"XP\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '⛏️  Mining', \"miningLevel\", \"miningXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🎣 Fishing', \"fishingLevel\", \"fishingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🔥 Firemaking', \"firemakingLevel\", \"firemakingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🍳 Cooking', \"cookingLevel\", \"cookingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🔨 Smithing', \"smithingLevel\", \"smithingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '✂️  Crafting', \"craftingLevel\", \"craftingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🏹 Fletching', \"fletchingLevel\", \"fletchingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🔮 Runecrafting', \"runecraftingLevel\", \"runecraftingXp\"
  FROM characters WHERE id = '$AGENT_ID'
UNION ALL SELECT
  '🏃 Agility', \"agilityLevel\", COALESCE(\"agilityXp\", 0)
  FROM characters WHERE id = '$AGENT_ID';
"

# ─── XP Summary ───────────────────────────────────────────────────────────────
echo -e "${B}━━━ XP SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
sql "
SELECT
  \"attackXp\" + \"strengthXp\" + \"defenseXp\" + \"constitutionXp\" +
  \"rangedXp\" + \"magicXp\" + \"prayerXp\" AS \"Combat XP\",
  \"woodcuttingXp\" + \"miningXp\" + \"fishingXp\" + \"firemakingXp\" +
  \"cookingXp\" + \"smithingXp\" + \"craftingXp\" + \"fletchingXp\" +
  \"runecraftingXp\" + COALESCE(\"agilityXp\", 0) AS \"Skilling XP\",
  \"attackXp\" + \"strengthXp\" + \"defenseXp\" + \"constitutionXp\" +
  \"rangedXp\" + \"magicXp\" + \"prayerXp\" +
  \"woodcuttingXp\" + \"miningXp\" + \"fishingXp\" + \"firemakingXp\" +
  \"cookingXp\" + \"smithingXp\" + \"craftingXp\" + \"fletchingXp\" +
  \"runecraftingXp\" + COALESCE(\"agilityXp\", 0) AS \"Total XP\",
  (SELECT count(*) FROM quest_progress WHERE \"playerId\" = '$AGENT_ID' AND status = 'completed') || ' completed, ' ||
  (SELECT count(*) FROM quest_progress WHERE \"playerId\" = '$AGENT_ID' AND status != 'completed') || ' active' AS \"Quests\"
FROM characters WHERE id = '$AGENT_ID';
"

# ─── Equipment ────────────────────────────────────────────────────────────────
echo -e "${B}━━━ EQUIPPED GEAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
GEAR_COUNT=$(sqlt "SELECT count(*) FROM equipment WHERE \"playerId\" = '$AGENT_ID' AND \"itemId\" IS NOT NULL;")
if [[ "$GEAR_COUNT" == "0" ]]; then
  echo -e "  ${D}(nothing equipped)${N}"
else
  sql "
  SELECT
    \"slotType\" AS \"Slot\",
    \"itemId\" AS \"Item\",
    quantity AS \"Qty\"
  FROM equipment
  WHERE \"playerId\" = '$AGENT_ID' AND \"itemId\" IS NOT NULL
  ORDER BY \"slotType\";
  "
fi

# ─── Inventory ────────────────────────────────────────────────────────────────
echo -e "${B}━━━ INVENTORY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
INV_COUNT=$(sqlt "SELECT count(*) FROM inventory WHERE \"playerId\" = '$AGENT_ID';")
echo -e "  Slots: ${B}${INV_COUNT}/28${N} used, $((28 - INV_COUNT)) free"
echo ""
if [[ "$INV_COUNT" != "0" ]]; then
  sql "
  SELECT
    \"slotIndex\" AS \"Slot\",
    \"itemId\" AS \"Item\",
    quantity AS \"Qty\"
  FROM inventory
  WHERE \"playerId\" = '$AGENT_ID'
  ORDER BY \"slotIndex\";
  "
fi

# ─── Quest Progress ──────────────────────────────────────────────────────────
echo -e "${B}━━━ QUEST LOG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
QUEST_COUNT=$(sqlt "SELECT count(*) FROM quest_progress WHERE \"playerId\" = '$AGENT_ID';")
if [[ "$QUEST_COUNT" == "0" ]]; then
  echo -e "  ${D}(no quests started)${N}"
else
  sql "
  SELECT
    \"questId\" AS \"Quest\",
    status AS \"Status\",
    \"currentStage\" AS \"Current Stage\",
    \"stageProgress\"::text AS \"Progress\",
    CASE WHEN \"startedAt\" IS NOT NULL
      THEN to_char(to_timestamp(\"startedAt\" / 1000.0), 'HH24:MI:SS')
      ELSE '—' END AS \"Started\",
    CASE WHEN \"completedAt\" IS NOT NULL
      THEN to_char(to_timestamp(\"completedAt\" / 1000.0), 'HH24:MI:SS')
      ELSE '—' END AS \"Completed\"
  FROM quest_progress
  WHERE \"playerId\" = '$AGENT_ID'
  ORDER BY
    CASE status WHEN 'in_progress' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
    \"questId\";
  "
fi

# ─── Quest Audit Trail ───────────────────────────────────────────────────────
echo -e "${B}━━━ QUEST AUDIT TRAIL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
AUDIT_COUNT=$(sqlt "SELECT count(*) FROM quest_audit_log WHERE \"playerId\" = '$AGENT_ID';" 2>/dev/null || echo "0")
if [[ "$AUDIT_COUNT" == "0" || -z "$AUDIT_COUNT" ]]; then
  echo -e "  ${D}(no audit entries)${N}"
else
  sql "
  SELECT
    \"questId\" AS \"Quest\",
    action AS \"Action\",
    \"questPointsAwarded\" AS \"QP\",
    to_char(to_timestamp(timestamp / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS \"Time\"
  FROM quest_audit_log
  WHERE \"playerId\" = '$AGENT_ID'
  ORDER BY timestamp DESC
  LIMIT 20;
  " 2>/dev/null || echo -e "  ${D}(audit log not available)${N}"
fi

# ─── Death History ────────────────────────────────────────────────────────────
echo -e "${B}━━━ DEATH STATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
DEATH_EXISTS=$(sqlt "SELECT count(*) FROM death_tracking WHERE \"playerId\" = '$AGENT_ID';" 2>/dev/null || echo "0")
if [[ "$DEATH_EXISTS" != "0" && -n "$DEATH_EXISTS" ]]; then
  sql "
  SELECT
    \"itemCount\" AS \"Items Lost\",
    \"killedBy\" AS \"Killed By\",
    zone AS \"Death Zone\",
    \"gravestoneId\" AS \"Gravestone\"
  FROM death_tracking
  WHERE \"playerId\" = '$AGENT_ID';
  " 2>/dev/null
else
  echo -e "  ${G}No pending deaths${N}"
fi

# ─── Summary Bar ──────────────────────────────────────────────────────────────
echo ""
echo -e "${B}━━━ QUICK STATS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
TOTAL_XP=$(sqlt "
SELECT \"attackXp\" + \"strengthXp\" + \"defenseXp\" + \"constitutionXp\" +
  \"rangedXp\" + \"magicXp\" + \"prayerXp\" +
  \"woodcuttingXp\" + \"miningXp\" + \"fishingXp\" + \"firemakingXp\" +
  \"cookingXp\" + \"smithingXp\" + \"craftingXp\" + \"fletchingXp\" +
  \"runecraftingXp\" + COALESCE(\"agilityXp\", 0)
FROM characters WHERE id = '$AGENT_ID';
")
TOTAL_LEVEL=$(sqlt "
SELECT \"attackLevel\" + \"strengthLevel\" + \"defenseLevel\" + \"constitutionLevel\" +
  \"rangedLevel\" + \"magicLevel\" + \"prayerLevel\" +
  \"woodcuttingLevel\" + \"miningLevel\" + \"fishingLevel\" + \"firemakingLevel\" +
  \"cookingLevel\" + \"smithingLevel\" + \"craftingLevel\" + \"fletchingLevel\" +
  \"runecraftingLevel\" + \"agilityLevel\"
FROM characters WHERE id = '$AGENT_ID';
")
QP=$(sqlt "SELECT \"questPoints\" FROM characters WHERE id = '$AGENT_ID';")
COINS=$(sqlt "SELECT coins FROM characters WHERE id = '$AGENT_ID';")
COMPLETED=$(sqlt "SELECT count(*) FROM quest_progress WHERE \"playerId\" = '$AGENT_ID' AND status = 'completed';")

echo -e "  Total Level:   ${B}${TOTAL_LEVEL}${N}"
echo -e "  Total XP:      ${B}${TOTAL_XP}${N}"
echo -e "  Quest Points:  ${B}${QP}${N}"
echo -e "  Quests Done:   ${B}${COMPLETED}${N}"
echo -e "  Coins:         ${B}${COINS}${N}"
echo -e "  Gear Pieces:   ${B}${GEAR_COUNT}${N}"
echo -e "  Inventory:     ${B}${INV_COUNT}/28${N}"
echo ""
