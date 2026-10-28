import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ApiProvider } from "@cinakey/api-client";
import { App } from "./App";
import "./index.css";
const url = import.meta.env.VITE_CONVEX_URL;
if (!url)
  throw new Error(
    "Set VITE_CONVEX_URL in apps/admin/.env.local; see .env.example.",
  );
const convex = new ConvexReactClient(url);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ApiProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ApiProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
