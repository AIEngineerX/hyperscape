import { GAME_API_URL } from "./config";

export async function fetchGoldPriceUsd(
  goldMint: string,
): Promise<number | null> {
  const response = await fetch(
    `${GAME_API_URL}/api/proxy/birdeye/price?address=${encodeURIComponent(goldMint)}`,
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    data?: { value?: number };
  };

  return data.data?.value ?? null;
}
