import { Nango } from "@nangohq/node";

export const GITHUB_PROVIDER = "github";

let client: Nango | null = null;

export function getNango(): Nango {
  if (client) return client;
  const secretKey = process.env.NANGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("NANGO_SECRET_KEY is not configured");
  }
  client = new Nango({ secretKey });
  return client;
}

export function getGithubIntegrationId(): string {
  return process.env.NANGO_GITHUB_INTEGRATION_ID ?? "github";
}

export function isGithubAppIntegration(integrationId?: string): boolean {
  const id = integrationId ?? getGithubIntegrationId();
  return id.includes("github-app") || id.includes("github_app");
}

export function isNangoConfigured(): boolean {
  return Boolean(process.env.NANGO_SECRET_KEY);
}
