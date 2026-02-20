/**
 * ChainContext — React context for managing active chain selection.
 *
 * Handles:
 * - Current active chain (Solana, BSC, Base)
 * - Auto-detection based on connected wallet type
 * - Caching largest market to localStorage
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChainId } from "./chainConfig";
import { getAvailableChains, LARGEST_MARKET_CACHE_KEY } from "./chainConfig";

// ============================================================================
// Types
// ============================================================================

type ChainContextValue = {
  activeChain: ChainId;
  setActiveChain: (chain: ChainId) => void;
  availableChains: ChainId[];
};

// ============================================================================
// Context
// ============================================================================

const ChainCtx = createContext<ChainContextValue>({
  activeChain: "solana",
  setActiveChain: () => {},
  availableChains: ["solana"],
});

// ============================================================================
// Provider
// ============================================================================

function getDefaultChain(): ChainId {
  const available = getAvailableChains();

  // Check localStorage for cached largest market
  try {
    const cached = localStorage.getItem(LARGEST_MARKET_CACHE_KEY);
    if (cached && available.includes(cached as ChainId)) {
      return cached as ChainId;
    }
  } catch {
    // localStorage not available
  }

  // Default to Solana
  return "solana";
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const availableChains = useMemo(() => getAvailableChains(), []);
  const [activeChain, setActiveChainRaw] = useState<ChainId>(getDefaultChain);

  const setActiveChain = useCallback(
    (chain: ChainId) => {
      if (availableChains.includes(chain)) {
        setActiveChainRaw(chain);
        try {
          localStorage.setItem("goldArena_selectedChain", chain);
        } catch {
          // ignore
        }
      }
    },
    [availableChains],
  );

  // If the stored chain is not available, fall back to solana
  useEffect(() => {
    if (!availableChains.includes(activeChain)) {
      setActiveChainRaw("solana");
    }
  }, [availableChains, activeChain]);

  const value = useMemo<ChainContextValue>(
    () => ({
      activeChain,
      setActiveChain,
      availableChains,
    }),
    [activeChain, setActiveChain, availableChains],
  );

  return <ChainCtx.Provider value={value}>{children}</ChainCtx.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useChain(): ChainContextValue {
  return useContext(ChainCtx);
}
