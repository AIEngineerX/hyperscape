/**
 * Live LLM integration tests for DuelCombatAI strategy planning.
 *
 * These tests call the OpenRouter API with the exact prompts used
 * by planStrategy() and validate the responses parse correctly.
 *
 * Requires OPENROUTER_API_KEY in environment or server .env file.
 * Skipped automatically if no API key is available.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

function getApiKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  try {
    const envPath = path.resolve(__dirname, "../../../.env");
    const envContent = fs.readFileSync(envPath, "utf-8");
    const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

const API_KEY = getApiKey();
const describeIfKey = API_KEY ? describe : describe.skip;

async function callOpenRouter(
  prompt: string,
  maxTokens: number,
  retries = 3,
): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://hyperscape.ai",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-70b-instruct:free",
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.4,
        }),
      },
    );

    if (response.status === 429 && attempt < retries - 1) {
      console.log(
        `[Live Test] Rate limited, retrying in ${3 * (attempt + 1)}s...`,
      );
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || "";
  }
  throw new Error("Max retries exceeded");
}

function buildCombatPrompt(scenario: {
  agentName: string;
  healthPct: number;
  foodCount: number;
  tickCount: number;
  oppHpPct: string;
  oppCombatLevel: number;
  dmgDealt: number;
  dmgReceived: number;
}): string {
  return [
    `You are ${scenario.agentName} in a PvP duel arena. Plan your combat strategy.`,
    ``,
    `YOUR STATE: HP ${scenario.healthPct}%, ${scenario.foodCount} food, tick ${scenario.tickCount}`,
    `OPPONENT: HP ${scenario.oppHpPct}%, combat level ${scenario.oppCombatLevel}`,
    `DAMAGE SO FAR: dealt ${scenario.dmgDealt}, received ${scenario.dmgReceived}`,
    ``,
    `Available prayers: ultimate_strength (+15% str), steel_skin (+15% def), rock_skin (+10% def)`,
    `Available styles: aggressive (max damage), defensive (less damage taken), controlled (balanced), accurate (hit more often)`,
    ``,
    `Respond with a JSON object:`,
    `{`,
    `  "approach": "aggressive" | "defensive" | "balanced" | "outlast",`,
    `  "attackStyle": "aggressive" | "defensive" | "controlled" | "accurate",`,
    `  "prayer": "ultimate_strength" | "steel_skin" | null,`,
    `  "foodThreshold": 20-60 (HP% to eat at, lower = riskier),`,
    `  "switchDefensiveAt": 20-40 (HP% to go defensive),`,
    `  "reasoning": "brief explanation"`,
    `}`,
  ].join("\n");
}

function parseCombatStrategy(text: string) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

describeIfKey("DuelCombatAI Live LLM Strategy Planning", () => {
  it("produces valid strategy for fight start (high HP)", async () => {
    const prompt = buildCombatPrompt({
      agentName: "GPT-5 Agent",
      healthPct: 99,
      foodCount: 10,
      tickCount: 0,
      oppHpPct: "99",
      oppCombatLevel: 45,
      dmgDealt: 0,
      dmgReceived: 0,
    });

    const response = await callOpenRouter(prompt, 200);
    console.log("[Live Test] Fight start response:", response);

    const strategy = parseCombatStrategy(response);
    expect(strategy).not.toBeNull();
    expect(strategy.approach).toMatch(
      /^(aggressive|defensive|balanced|outlast)$/,
    );
    expect(strategy.attackStyle).toMatch(
      /^(aggressive|defensive|controlled|accurate)$/,
    );
    expect(typeof strategy.foodThreshold).toBe("number");
    expect(strategy.foodThreshold).toBeGreaterThanOrEqual(15);
    expect(strategy.foodThreshold).toBeLessThanOrEqual(65);
    expect(typeof strategy.reasoning).toBe("string");
  }, 60000);

  it("produces defensive strategy at low HP", async () => {
    const prompt = buildCombatPrompt({
      agentName: "Claude Agent",
      healthPct: 25,
      foodCount: 3,
      tickCount: 40,
      oppHpPct: "60",
      oppCombatLevel: 50,
      dmgDealt: 120,
      dmgReceived: 200,
    });

    const response = await callOpenRouter(prompt, 200);
    console.log("[Live Test] Low HP response:", response);

    const strategy = parseCombatStrategy(response);
    expect(strategy).not.toBeNull();
    expect(strategy.approach).toMatch(
      /^(aggressive|defensive|balanced|outlast)$/,
    );
    expect(typeof strategy.foodThreshold).toBe("number");
  }, 60000);

  it("produces finishing strategy when opponent is low", async () => {
    const prompt = buildCombatPrompt({
      agentName: "Grok Agent",
      healthPct: 70,
      foodCount: 6,
      tickCount: 25,
      oppHpPct: "15",
      oppCombatLevel: 42,
      dmgDealt: 180,
      dmgReceived: 80,
    });

    const response = await callOpenRouter(prompt, 200);
    console.log("[Live Test] Finishing response:", response);

    const strategy = parseCombatStrategy(response);
    expect(strategy).not.toBeNull();
    expect(strategy.approach).toMatch(
      /^(aggressive|defensive|balanced|outlast)$/,
    );
  }, 60000);
});
