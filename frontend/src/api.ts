import { API_BASE } from "./lib";

export type User = {
  id: number;
  username: string;
  role: "admin" | "user";
  createdAt?: string;
};

export type Paste = {
  id: string;
  title: string;
  content?: string;
  language: string;
  format: "code" | "markdown";
  isPrivate: boolean;
  hasPassword: boolean;
  burnAfterReading: boolean;
  expiresAt?: string | null;
  views: number;
  ownerUsername?: string | null;
  createdAt: string;
};

export type Settings = {
  allowAnonymousPaste: boolean;
  siteName: string;
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("letspaste_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
