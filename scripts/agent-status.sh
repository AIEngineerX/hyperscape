#!/usr/bin/env bash
#
# agent-status.sh — Comprehensive agent status report
#
# Shows quests, skills, equipment, inventory, coins, health, position,
# and quest audit trail for all AI agents.
#
# Usage:
#   ./scripts/agent-status.sh
#   DATABASE_URL="postgresql://..." ./scripts/agent-status.sh
#   ./scripts/agent-status.sh --db "postgresql://..."
#

set -euo pipefail

# ─── Resolve DATABASE_URL ─────────────────────────────────────────────────────
if [[ "${1:-}" == "--db" && -n "${2:-}" ]]; then
  DB_URL="$2"
elif [[ -n "${DATABASE_URL:-}" ]]; then
  DB_URL="$DATABASE_URL"
elif [[ -f "packages/server/.env" ]]; then
  DB_URL=$(grep '^DATABASE_URL=' packages/server/.env | head -1 | cut -d'=' -f2-)
elif [[ -f ".env" ]]; then
  DB_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d'=' -f2-)
else
  echo "ERROR: No DATABASE_URL found."
  echo "Usage: DATABASE_URL=... $0"
  echo "   or: $0 --db \"postgresql://...\""
  exit 1
fi

# Extract password for PGPASSWORD (handles both direct and pooler URLs)
export PGPASSWORD
PGPASSWORD=$(echo "$DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

run_sql() {
  psql "$DB_URL" -t -A -F$'\t' -c "$1" 2>/dev/null
}

run_sql_pretty() {
  psql "$DB_URL" -c "$1" 2>/dev/null
}

BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
MAGENTA="\033[35m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║           🤖  AGENT STATUS REPORT                          ║${RESET}"
echo -e "${BOLD}║           $(date '+%Y-%m-%d %H:%M:%S %Z')                        ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"

# ─── Agent Count ──────────────────────────────────────────────────────────────
AGENT_COUNT=$(run_sql "SELECT count(*) FROM characters WHERE \"isAgent\" = 1;")
echo ""
echo -e "${CYAN}Agents in database:${RESET} ${BOLD}${AGENT_COUNT}${RESET}"

# ─── Quest Progress ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ QUEST PROGRESS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  COALESCE(q.\"questId\", '—') AS \"Quest\",
  COALESCE(q.status, '—') AS \"Status\",
  COALESCE(q.\"currentStage\", '—') AS \"Stage\",
  COALESCE(q.\"stageProgress\"::text, '{}') AS \"Progress\",
  c.\"questPoints\" AS \"QP\"
FROM characters c
LEFT JOIN quest_progress q ON q.\"playerId\" = c.id
WHERE c.\"isAgent\" = 1
ORDER BY c.name;
"

# ─── Combat Skills ────────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ COMBAT SKILLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  c.\"attackLevel\" AS \"ATK\",
  c.\"strengthLevel\" AS \"STR\",
  c.\"defenseLevel\" AS \"DEF\",
  c.\"constitutionLevel\" AS \"HP\",
  c.\"rangedLevel\" AS \"RNG\",
  c.\"magicLevel\" AS \"MAG\",
  c.\"prayerLevel\" AS \"PRA\"
FROM characters c
WHERE c.\"isAgent\" = 1
ORDER BY c.name;
"

# ─── Gathering/Production Skills ──────────────────────────────────────────────
echo -e "${BOLD}━━━ GATHERING & PRODUCTION SKILLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  c.\"woodcuttingLevel\" AS \"WC\",
  c.\"miningLevel\" AS \"MINE\",
  c.\"fishingLevel\" AS \"FISH\",
  c.\"firemakingLevel\" AS \"FM\",
  c.\"cookingLevel\" AS \"COOK\",
  c.\"smithingLevel\" AS \"SMITH\",
  c.\"craftingLevel\" AS \"CRAFT\",
  c.\"fletchingLevel\" AS \"FLETCH\",
  c.\"runecraftingLevel\" AS \"RC\",
  c.\"agilityLevel\" AS \"AGI\"
FROM characters c
WHERE c.\"isAgent\" = 1
ORDER BY c.name;
"

# ─── XP Totals ────────────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ XP TOTALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  c.\"attackXp\" + c.\"strengthXp\" + c.\"defenseXp\" + c.\"constitutionXp\" +
  c.\"rangedXp\" + c.\"magicXp\" + c.\"prayerXp\" AS \"Combat XP\",
  c.\"woodcuttingXp\" + c.\"miningXp\" + c.\"fishingXp\" + c.\"firemakingXp\" +
  c.\"cookingXp\" + c.\"smithingXp\" + c.\"craftingXp\" + c.\"fletchingXp\" +
  c.\"runecraftingXp\" + COALESCE(c.\"agilityXp\", 0) AS \"Skilling XP\",
  c.\"attackXp\" + c.\"strengthXp\" + c.\"defenseXp\" + c.\"constitutionXp\" +
  c.\"rangedXp\" + c.\"magicXp\" + c.\"prayerXp\" +
  c.\"woodcuttingXp\" + c.\"miningXp\" + c.\"fishingXp\" + c.\"firemakingXp\" +
  c.\"cookingXp\" + c.\"smithingXp\" + c.\"craftingXp\" + c.\"fletchingXp\" +
  c.\"runecraftingXp\" + COALESCE(c.\"agilityXp\", 0) AS \"Total XP\"
FROM characters c
WHERE c.\"isAgent\" = 1
ORDER BY \"Total XP\" DESC;
"

# ─── Equipment ────────────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ EQUIPPED GEAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  e.\"slotType\" AS \"Slot\",
  e.\"itemId\" AS \"Item\"
FROM equipment e
JOIN characters c ON c.id = e.\"playerId\"
WHERE c.\"isAgent\" = 1 AND e.\"itemId\" IS NOT NULL
ORDER BY c.name, e.\"slotType\";
"

# ─── Inventory Summary ────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ INVENTORY SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  c.coins AS \"Coins\",
  (SELECT count(*) FROM inventory i WHERE i.\"playerId\" = c.id) AS \"Slots Used\",
  28 - (SELECT count(*) FROM inventory i WHERE i.\"playerId\" = c.id) AS \"Free\",
  (SELECT string_agg(i.\"itemId\" || ' x' || i.quantity, ', ' ORDER BY i.quantity DESC)
   FROM (
     SELECT \"itemId\", sum(quantity) as quantity
     FROM inventory
     WHERE \"playerId\" = c.id
     GROUP BY \"itemId\"
   ) i
  ) AS \"Items\"
FROM characters c
WHERE c.\"isAgent\" = 1
ORDER BY c.name;
"

# ─── Health & Position ────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ HEALTH & POSITION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  c.health || '/' || c.\"maxHealth\" AS \"HP\",
  '(' || round(c.\"positionX\"::numeric, 1) || ', ' ||
  round(c.\"positionY\"::numeric, 1) || ', ' ||
  round(c.\"positionZ\"::numeric, 1) || ')' AS \"Position\",
  to_char(to_timestamp(c.\"lastLogin\" / 1000.0), 'HH24:MI:SS') AS \"Last Active\"
FROM characters c
WHERE c.\"isAgent\" = 1
ORDER BY c.name;
"

# ─── Death State ──────────────────────────────────────────────────────────────
DEATH_COUNT=$(run_sql "
SELECT count(*) FROM death_tracking dt
JOIN characters c ON c.id = dt.\"playerId\"
WHERE c.\"isAgent\" = 1;
" 2>/dev/null || echo "0")

if [[ "$DEATH_COUNT" != "0" ]] && [[ "$DEATH_COUNT" != "" ]]; then
  echo -e "${BOLD}━━━ PENDING DEATHS (gravestones) ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  run_sql_pretty "
  SELECT
    c.name AS \"Agent\",
    dt.\"itemCount\" AS \"Items Lost\",
    dt.\"killedBy\" AS \"Killed By\",
    dt.zone AS \"Zone\"
  FROM death_tracking dt
  JOIN characters c ON c.id = dt.\"playerId\"
  WHERE c.\"isAgent\" = 1
  ORDER BY c.name;
  " 2>/dev/null || true
fi

# ─── Quest Audit Log (recent) ────────────────────────────────────────────────
AUDIT_COUNT=$(run_sql "SELECT count(*) FROM quest_audit_log WHERE \"playerId\" IN (SELECT id FROM characters WHERE \"isAgent\" = 1);" 2>/dev/null || echo "0")

if [[ "$AUDIT_COUNT" != "0" ]] && [[ "$AUDIT_COUNT" != "" ]]; then
  echo -e "${BOLD}━━━ QUEST AUDIT LOG (last 10) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  run_sql_pretty "
  SELECT
    c.name AS \"Agent\",
    qa.\"questId\" AS \"Quest\",
    qa.action AS \"Action\",
    to_char(to_timestamp(qa.timestamp / 1000.0), 'HH24:MI:SS') AS \"Time\"
  FROM quest_audit_log qa
  JOIN characters c ON c.id = qa.\"playerId\"
  WHERE c.\"isAgent\" = 1
  ORDER BY qa.timestamp DESC
  LIMIT 10;
  " 2>/dev/null || true
fi

# ─── Duel Stats ───────────────────────────────────────────────────────────────
echo -e "${BOLD}━━━ DUEL RECORD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
run_sql_pretty "
SELECT
  c.name AS \"Agent\",
  COALESCE(ds.wins, 0) AS \"Wins\",
  COALESCE(ds.losses, 0) AS \"Losses\",
  CASE WHEN COALESCE(ds.wins, 0) + COALESCE(ds.losses, 0) > 0
    THEN round(100.0 * COALESCE(ds.wins, 0) / (COALESCE(ds.wins, 0) + COALESCE(ds.losses, 0)), 0) || '%'
    ELSE '—'
  END AS \"Win%\"
FROM characters c
LEFT JOIN streaming_duel_stats ds ON ds.\"agentId\" = c.id
WHERE c.\"isAgent\" = 1
ORDER BY COALESCE(ds.wins, 0) DESC;
" 2>/dev/null || echo -e "  ${DIM}(streaming_duel_stats table not found)${RESET}"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

TOTAL_KILLS=$(run_sql "
SELECT COALESCE(sum((q.\"stageProgress\"::json->>'kills')::int), 0)
FROM quest_progress q
JOIN characters c ON c.id = q.\"playerId\"
WHERE c.\"isAgent\" = 1 AND q.\"questId\" = 'goblin_slayer';
" 2>/dev/null || echo "0")

COMPLETED_QUESTS=$(run_sql "
SELECT count(*)
FROM quest_progress q
JOIN characters c ON c.id = q.\"playerId\"
WHERE c.\"isAgent\" = 1 AND q.status = 'completed';
" 2>/dev/null || echo "0")

TOTAL_GEAR=$(run_sql "
SELECT count(*)
FROM equipment e
JOIN characters c ON c.id = e.\"playerId\"
WHERE c.\"isAgent\" = 1 AND e.\"itemId\" IS NOT NULL;
" 2>/dev/null || echo "0")

TOTAL_COINS=$(run_sql "
SELECT COALESCE(sum(c.coins), 0)
FROM characters c
WHERE c.\"isAgent\" = 1;
" 2>/dev/null || echo "0")

echo -e "  Agents:           ${BOLD}${AGENT_COUNT}${RESET}"
echo -e "  Total Goblin Kills: ${BOLD}${TOTAL_KILLS}${RESET} / $(( AGENT_COUNT * 15 )) needed"
echo -e "  Quests Completed: ${BOLD}${COMPLETED_QUESTS}${RESET}"
echo -e "  Gear Equipped:    ${BOLD}${TOTAL_GEAR}${RESET} pieces across all agents"
echo -e "  Total Coins:      ${BOLD}${TOTAL_COINS}${RESET}"
echo ""
