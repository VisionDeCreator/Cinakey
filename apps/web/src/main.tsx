import { cleanBillingReturnUrl } from "@/features/settings/billing-return";
import { AppRouter } from "@/app/router";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { ApiProvider } from "@/lib/api/ApiProvider";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";

const cleanReturn = cleanBillingReturnUrl(window.location.href);
if (cleanReturn)
  window.history.replaceState(window.history.state, "", cleanReturn);

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing VITE_CONVEX_URL. Set it in apps/web/.env.local (see .env.example).",
  );
}

const convex = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <ApiProvider>
        <BrowserRouter>
          <ConfirmProvider>
            <AppRouter />
          </ConfirmProvider>
        </BrowserRouter>
      </ApiProvider>
    </ConvexAuthProvider>
  </StrictMode>,
);
