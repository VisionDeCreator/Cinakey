import { createContext, useContext } from "react";
import type { ApiClient } from "./client";
export const Context = createContext<ApiClient | null>(null);
export function useClient() {
  const client = useContext(Context);
  if (!client) throw new Error("API hooks require ApiProvider");
  return client;
}
