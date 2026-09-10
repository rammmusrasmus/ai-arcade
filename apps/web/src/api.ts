import { ApiClient, ApiClientError } from "@ai-arcade/shared";

// In dev, VITE_API_URL points at the standalone API (:4000). When the web build
// is served by the API itself (e.g. through a share tunnel), talk same-origin.
export const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4000");

/**
 * Web uses the httpOnly session cookie for auth. We attach `x-aa-app: 1` on
 * every request so the API's CSRF guard accepts cookie-authenticated mutations.
 */
export const api = new ApiClient({
  baseUrl: API_URL,
  credentials: "include",
  defaultHeaders: () => ({ "x-aa-app": "1", "x-client": "web" }),
});

export { ApiClientError };

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
