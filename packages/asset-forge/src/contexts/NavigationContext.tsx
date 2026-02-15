import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "../constants/navigation";

interface NavigationContextValue {
  selectedAssetId: string | null;
  setSelectedAssetId: (assetId: string | null) => void;
  navigateToAsset: (assetId: string) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // Note: navigateToAsset is implemented by consumers using useNavigate from react-router
  // This context just manages the selected asset ID state
  const navigateToAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({
      selectedAssetId,
      setSelectedAssetId,
      navigateToAsset,
    }),
    [selectedAssetId, navigateToAsset],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return context;
};

// Hook that combines navigation context with react-router navigation
export const useAssetNavigation = () => {
  const { selectedAssetId, setSelectedAssetId } = useNavigation();
  const navigate = useNavigate();

  const navigateToAsset = useCallback(
    (assetId: string) => {
      setSelectedAssetId(assetId);
      navigate(ROUTES.ASSETS);
    },
    [setSelectedAssetId, navigate],
  );

  return {
    selectedAssetId,
    setSelectedAssetId,
    navigateToAsset,
  };
};
