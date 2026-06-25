import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function normalizeBasePath(base: string) {
  const pathname = new URL(base || "/", window.location.origin).pathname;
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === "" ? "" : normalized;
}

function withBasePath(pathname: string) {
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  if (!basePath) return pathname;
  if (pathname === "/") return `${basePath}/`;
  return `${basePath}${pathname}`;
}

export function pastePermalink(id: string) {
  return new URL(withBasePath(`/${encodeURIComponent(id)}`), window.location.origin).toString();
}

export async function copyText(value: string) {
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back for embedded browsers or restrictive clipboard permissions.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
