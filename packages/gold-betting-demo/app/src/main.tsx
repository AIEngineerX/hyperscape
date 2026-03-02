import "./lib/solanaCompat";
import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const LazyRoot = lazy(() => import("./AppRoot"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={
        <div
          style={{ background: "#050505", width: "100vw", height: "100vh" }}
        />
      }
    >
      <LazyRoot />
    </Suspense>
  </StrictMode>,
);
