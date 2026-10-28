export type Transfer = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};
let transfers: Transfer[] = [];
const listeners = new Set<() => void>();
export const uploadProgress = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => transfers,
  update(item: Transfer) {
    transfers = [...transfers.filter((row) => row.id !== item.id), item];
    listeners.forEach((fn) => fn());
  },
  clear() {
    transfers = transfers.filter((row) => row.status === "uploading");
    listeners.forEach((fn) => fn());
  },
};
