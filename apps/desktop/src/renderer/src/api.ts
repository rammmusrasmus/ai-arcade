import { ApiClient, ApiClientError } from "@ai-arcade/shared";

let cachedToken: string | null = null;

export async function loadToken(): Promise<string | null> {
  cachedToken = await window.arcade.getToken();
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  await window.arcade.setToken(token);
}

export async function makeApi(): Promise<ApiClient> {
  const { apiUrl } = await window.arcade.getConfig();
  await loadToken();
  return new ApiClient({
    baseUrl: apiUrl,
    credentials: "omit",
    getToken: () => cachedToken,
    // `bypass-tunnel-reminder` skips localtunnel's interstitial page; harmless otherwise.
    defaultHeaders: () => ({ "x-client": "desktop", "bypass-tunnel-reminder": "1" }),
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
