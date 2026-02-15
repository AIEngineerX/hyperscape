const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";

export async function fetchGoldPriceUsd(
  goldMint: string,
): Promise<number | null> {
  const apiKey = import.meta.env.VITE_BIRDEYE_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(
    `${BIRDEYE_BASE_URL}/defi/price?address=${encodeURIComponent(goldMint)}`,
    {
      headers: {
        "X-API-KEY": apiKey,
        "x-chain": "solana",
      },
    },
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    data?: { value?: number };
  };

  return data.data?.value ?? null;
}
