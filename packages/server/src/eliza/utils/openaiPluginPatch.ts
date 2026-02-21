import { createOpenAI } from "@ai-sdk/openai";
import type {
  GenerateTextParams,
  IAgentRuntime,
  Plugin,
  TextStreamResult,
} from "@elizaos/core";
import { ModelType } from "@elizaos/core";
import { generateText, streamText, type LanguageModelUsage } from "ai";

const PATCH_MARKER = "__hyperscape_openai_text_patch_applied__";

function getSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue?: string,
): string | undefined {
  const value = runtime.getSetting(key);
  if (value !== undefined && value !== null) {
    return String(value);
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  return process.env[key];
}

function getBaseURL(runtime: IAgentRuntime): string {
  return getSetting(runtime, "OPENAI_BASE_URL", "https://api.openai.com/v1")!;
}

function getApiKey(runtime: IAgentRuntime): string {
  return getSetting(runtime, "OPENAI_API_KEY", "")!;
}

function getSmallModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, "OPENAI_SMALL_MODEL") ??
    getSetting(runtime, "SMALL_MODEL", "gpt-5-nano")!
  );
}

function getLargeModel(runtime: IAgentRuntime): string {
  return (
    getSetting(runtime, "OPENAI_LARGE_MODEL") ??
    getSetting(runtime, "LARGE_MODEL", "gpt-5")!
  );
}

function getExperimentalTelemetry(runtime: IAgentRuntime): boolean {
  const setting = getSetting(runtime, "OPENAI_EXPERIMENTAL_TELEMETRY", "false");
  return String(setting).toLowerCase() === "true";
}

function convertUsage(
  usage: LanguageModelUsage | undefined,
):
  | { promptTokens: number; completionTokens: number; totalTokens: number }
  | undefined {
  if (!usage) {
    return undefined;
  }

  const usageRecord = usage as LanguageModelUsage & {
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };

  const promptTokens = usageRecord.inputTokens ?? usageRecord.promptTokens ?? 0;
  const completionTokens =
    usageRecord.outputTokens ?? usageRecord.completionTokens ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

async function generateTextWithoutUnsupportedSettings(
  runtime: IAgentRuntime,
  params: GenerateTextParams,
  modelName: string,
): Promise<string | TextStreamResult> {
  const openai = createOpenAI({
    apiKey: getApiKey(runtime),
    baseURL: getBaseURL(runtime),
  });

  const generateParams = {
    model: openai.chat(modelName),
    prompt: params.prompt,
    system: runtime.character.system ?? undefined,
    maxOutputTokens: params.maxTokens ?? 8192,
    experimental_telemetry: {
      isEnabled: getExperimentalTelemetry(runtime),
    },
  };

  if (params.stream) {
    const result = streamText(generateParams);
    return {
      textStream: result.textStream,
      text: Promise.resolve(result.text),
      usage: Promise.resolve(result.usage).then(convertUsage),
      finishReason: Promise.resolve(result.finishReason).then(
        (reason) => reason as string | undefined,
      ),
    };
  }

  const { text } = await generateText(generateParams);
  return text;
}

export function applyOpenAITextModelPatch(plugin: Plugin): Plugin {
  if (!plugin.models) {
    return plugin;
  }

  const pluginRecord = plugin as Plugin & Record<string, unknown>;
  if (pluginRecord[PATCH_MARKER]) {
    return plugin;
  }

  const patched: Plugin = {
    ...plugin,
    models: {
      ...plugin.models,
      [ModelType.TEXT_SMALL]: async (runtime, params) =>
        generateTextWithoutUnsupportedSettings(
          runtime,
          params as GenerateTextParams,
          getSmallModel(runtime),
        ),
      [ModelType.TEXT_LARGE]: async (runtime, params) =>
        generateTextWithoutUnsupportedSettings(
          runtime,
          params as GenerateTextParams,
          getLargeModel(runtime),
        ),
    },
  };

  (patched as Plugin & Record<string, unknown>)[PATCH_MARKER] = true;
  return patched;
}
