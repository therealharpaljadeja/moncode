import { upsertConnection, type Connection } from "@/lib/connections";
import {
  getGithubConnectionStatus,
  syncGithubDisplayName,
  type GithubConnectionStatus,
} from "@/lib/github";
import {
  getGithubIntegrationId,
  getNango,
  GITHUB_PROVIDER,
  isNangoConfigured,
} from "@/lib/nango";

type NangoListedConnection = {
  connection_id?: string;
  provider_config_key?: string;
  created?: string;
  end_user?: {
    id?: string;
    display_name?: string;
    email?: string;
  } | null;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown> | null;
};

/**
 * Find an existing GitHub connection in Nango for this user (by end_user_id tag).
 * Used after a soft disconnect so reconnect can re-authorize without a fresh install.
 */
export async function findGithubNangoConnectionId(
  userId: string,
): Promise<string | null> {
  if (!isNangoConfigured()) return null;

  const nango = getNango();
  const integrationId = getGithubIntegrationId();
  const listed = await listGithubConnectionsForUser(nango, userId, integrationId);
  const match = pickBestConnection(listed, integrationId);
  return match?.connection_id ?? null;
}

/**
 * Pull the user's GitHub connection from Nango and persist it locally.
 * Webhooks are the primary path; this covers local dev and missed webhooks.
 */
export async function syncGithubConnectionForUser(
  userId: string,
): Promise<Connection | null> {
  if (!isNangoConfigured()) return null;

  const nango = getNango();
  const integrationId = getGithubIntegrationId();

  const listed = await listGithubConnectionsForUser(nango, userId, integrationId);
  const match = pickBestConnection(listed, integrationId);
  const connectionId = match?.connection_id;
  if (!connectionId) return null;

  let row = await upsertConnection({
    userId,
    provider: GITHUB_PROVIDER,
    nangoConnectionId: connectionId,
    displayName: pickDisplayName(match, userId),
  });

  const displayName = await syncGithubDisplayName(userId, row);
  if (displayName && displayName !== row.displayName) {
    row = await upsertConnection({
      userId,
      provider: GITHUB_PROVIDER,
      nangoConnectionId: connectionId,
      displayName,
    });
  }

  return row;
}

/**
 * After a soft disconnect, Nango may still hold valid credentials.
 * Re-link Moncode locally without opening the Connect UI (which stalls on
 * GitHub's "app already installed" page when there is nothing new to authorize).
 */
export async function tryRestoreGithubFromNango(
  userId: string,
): Promise<GithubConnectionStatus | null> {
  if (!isNangoConfigured()) return null;
  if (!(await findGithubNangoConnectionId(userId))) return null;

  const row = await syncGithubConnectionForUser(userId);
  if (!row) return null;

  const status = await getGithubConnectionStatus(userId);
  if (status.connected && !status.invalid) {
    return status;
  }
  return null;
}

async function listGithubConnectionsForUser(
  nango: ReturnType<typeof getNango>,
  userId: string,
  integrationId: string,
): Promise<NangoListedConnection[]> {
  // Privy user IDs (did:privy:…) are stored as the end_user_id tag, not
  // Nango's endUserId filter — that query returns zero rows for DIDs.
  const byTag = await nango.listConnections({
    tags: { end_user_id: userId },
    integrationId: [integrationId],
    limit: 20,
  });
  const tagged = extractListedConnections(byTag);
  if (tagged.length > 0) return tagged;

  const byUserId = await nango.listConnections({
    userId,
    integrationId: [integrationId],
    limit: 20,
  });
  return extractListedConnections(byUserId);
}

function pickBestConnection(
  listed: NangoListedConnection[],
  integrationId: string,
): NangoListedConnection | undefined {
  const forIntegration = listed.filter(
    (c) => c.provider_config_key === integrationId,
  );
  const pool = forIntegration.length > 0 ? forIntegration : listed;
  return pool.sort((a, b) => {
    const aTime = Date.parse(a.created ?? "") || 0;
    const bTime = Date.parse(b.created ?? "") || 0;
    return bTime - aTime;
  })[0];
}

function pickDisplayName(
  match: NangoListedConnection,
  userId: string,
): string | null {
  const candidates = [
    match.end_user?.display_name,
    match.tags?.end_user_display_name,
    typeof match.metadata?.login === "string" ? match.metadata.login : null,
  ];
  for (const name of candidates) {
    if (typeof name === "string" && name && name !== userId) return name;
  }
  return null;
}

function extractListedConnections(response: unknown): NangoListedConnection[] {
  if (!response || typeof response !== "object") return [];
  const data = response as { connections?: unknown };
  if (!Array.isArray(data.connections)) return [];
  return data.connections as NangoListedConnection[];
}
