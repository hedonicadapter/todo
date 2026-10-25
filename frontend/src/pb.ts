import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";

export interface Todo extends RecordModel {
  title: string;
  done: boolean;
  due: string; // "" or PocketBase datetime string
  order: number;
  owner: string;
  repeat: string; // "" or RRULE subset, see recur.ts
}

// PocketBase date fields want "YYYY-MM-DD HH:MM:SS.sssZ"; due is date-only.
export const toPbDate = (ymd: string): string => (ymd ? `${ymd.slice(0, 10)} 00:00:00.000Z` : "");

// Prod: same origin (PocketBase serves the built frontend). Dev: vite proxies /api.
const url = import.meta.env.VITE_PB_URL ?? window.location.origin;

export const pb = new PocketBase(url);
// Don't cancel in-flight optimistic writes when a newer one starts.
pb.autoCancellation(false);

export const todosCollection = () => pb.collection<Todo>("todos");

export const isAuthed = () => pb.authStore.isValid && pb.authStore.record?.collectionName === "users";

export const authId = () => pb.authStore.record?.id ?? "";

export async function login(email: string, password: string): Promise<void> {
  await pb.collection("users").authWithPassword(email, password);
}

export function logout(): void {
  pb.authStore.clear();
}

export function onAuthChange(cb: () => void): () => void {
  return pb.authStore.onChange(cb);
}

export function isAuthError(err: unknown): boolean {
  return err instanceof ClientResponseError && (err.status === 401 || err.status === 403);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ClientResponseError) return err.response?.message || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
