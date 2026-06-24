import {
  getConnection,
  type Connection,
} from "@/lib/connections";
import {
  getGithubIntegrationId,
  getNango,
  GITHUB_PROVIDER,
  isGithubAppIntegration,
  isNangoConfigured,
} from "@/lib/nango";

export type GithubConnectionStatus = {
  connected: boolean;
  username?: string;
  connectionId?: string;
  invalid?: boolean;
};

export class GithubConnectionRequiredError extends Error {
  code = "GITHUB_CONNECTION_REQUIRED" as const;

  constructor(message = "Connect GitHub to continue.") {
    super(message);
    this.name = "GithubConnectionRequiredError";
  }
}

type NangoGithubConnection = Awaited<
  ReturnType<ReturnType<typeof getNango>["getConnection"]>
>;

async function getGithubNangoConnection(userId: string): Promise<{
  row: Connection;
  integrationId: string;
  remote: NangoGithubConnection;
  refreshAppJwt: boolean;
}> {
  const row = await getConnection(userId, GITHUB_PROVIDER);
  if (!row) {
    throw new GithubConnectionRequiredError();
  }

  const nango = getNango();
  const integrationId = getGithubIntegrationId();
  const refreshAppJwt = isGithubAppIntegration(integrationId);
  const remote = await nango.getConnection(
    integrationId,
    row.nangoConnectionId,
    false,
    false,
    refreshAppJwt,
  );

  return { row, integrationId, remote, refreshAppJwt };
}

export async function getGithubConnectionStatus(
  userId: string,
): Promise<GithubConnectionStatus> {
  if (!isNangoConfigured()) {
    return { connected: false };
  }

  const row = await getConnection(userId, GITHUB_PROVIDER);
  if (!row) {
    return { connected: false };
  }

  try {
    const { remote } = await getGithubNangoConnection(userId);

    // Metadata can exist while the access token is missing (stale app migration).
    try {
      await getGithubAccessToken(userId, remote);
    } catch {
      return {
        connected: false,
        invalid: true,
        connectionId: row.nangoConnectionId,
      };
    }

    const fromApi = userFromNangoConnection(remote);
    const username =
      row.displayName ??
      (typeof fromApi?.login === "string" ? fromApi.login : undefined) ??
      (typeof remote.metadata?.["login"] === "string"
        ? remote.metadata["login"]
        : undefined);

    return {
      connected: true,
      username,
      connectionId: row.nangoConnectionId,
    };
  } catch (err) {
    if (isInvalidNangoCredentials(err)) {
      return {
        connected: false,
        invalid: true,
        connectionId: row.nangoConnectionId,
      };
    }
    throw err;
  }
}

export async function getGithubAccessToken(
  userId: string,
  cachedRemote?: NangoGithubConnection,
): Promise<string> {
  let row: Connection;
  let integrationId: string;
  let remote: NangoGithubConnection;
  let refreshAppJwt: boolean;

  if (cachedRemote) {
    const existing = await getConnection(userId, GITHUB_PROVIDER);
    if (!existing) throw new GithubConnectionRequiredError();
    row = existing;
    integrationId = getGithubIntegrationId();
    remote = cachedRemote;
    refreshAppJwt = isGithubAppIntegration(integrationId);
  } else {
    const ctx = await getGithubNangoConnection(userId);
    row = ctx.row;
    integrationId = ctx.integrationId;
    remote = ctx.remote;
    refreshAppJwt = ctx.refreshAppJwt;
  }

  const fromUserOAuth = extractGithubUserAccessToken(remote, integrationId);
  if (fromUserOAuth) return fromUserOAuth;

  const nango = getNango();
  const token = await nango.getToken(
    integrationId,
    row.nangoConnectionId,
    false,
    refreshAppJwt,
  );

  // For github-app-oauth, getToken may return installation (APP) credentials —
  // never use those for /user or POST /user/repos.
  if (!isGithubAppIntegration(integrationId)) {
    if (typeof token === "string" && token) return token;
    const fromToken = extractAccessToken(token);
    if (fromToken) return fromToken;
  }

  if (isGithubAppIntegration(integrationId)) {
    throw new GithubConnectionRequiredError(
      "GitHub App is installed but user OAuth is missing. In your GitHub App settings, enable \"Request user authorization (OAuth) during installation\", then disconnect and reconnect in Moncode.",
    );
  }

  throw new GithubConnectionRequiredError(
    "GitHub credentials are missing. Disconnect and reconnect your account.",
  );
}

export async function syncGithubDisplayName(
  userId: string,
  row: Connection,
): Promise<string | null> {
  try {
    const { remote } = await getGithubNangoConnection(userId);
    const fromNango = userFromNangoConnection(remote);
    if (typeof fromNango?.login === "string") return fromNango.login;

    const token = await getGithubAccessToken(userId);
    const res = await githubFetch("https://api.github.com/user", token);
    if (!res.ok) return row.displayName;
    const data = (await res.json()) as { login?: string };
    return typeof data.login === "string" ? data.login : row.displayName;
  } catch {
    return row.displayName;
  }
}

type GithubOp =
  | {
      op: "create_repo";
      name: string;
      description?: string;
      private?: boolean;
    }
  | {
      op: "create_pr";
      owner: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body?: string;
    }
  | {
      op: "list_repos";
      per_page?: number;
    }
  | {
      op: "get_user";
    };

export async function runGithubOp(
  userId: string,
  input: GithubOp,
): Promise<unknown> {
  const token = await getGithubAccessToken(userId);

  switch (input.op) {
    case "get_user": {
      const { remote } = await getGithubNangoConnection(userId);
      const token = await getGithubAccessToken(userId, remote);
      const res = await githubFetch("https://api.github.com/user", token);
      if (res.ok) return res.json();

      const fromNango = userFromNangoConnection(remote);
      if (fromNango) return fromNango;

      throw new Error(await readGithubError(res, "get_user"));
    }
    case "list_repos": {
      const perPage = input.per_page ?? 30;
      const res = await githubFetch(
        `https://api.github.com/user/repos?per_page=${perPage}&sort=updated`,
        token,
      );
      if (!res.ok) throw new Error(await readGithubError(res, "list_repos"));
      return res.json();
    }
    case "create_repo": {
      const res = await githubFetch("https://api.github.com/user/repos", token, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          private: input.private ?? false,
          auto_init: true,
        }),
      });
      if (!res.ok) throw new Error(await readGithubError(res, "create_repo"));
      return res.json();
    }
    case "create_pr": {
      const res = await githubFetch(
        `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            head: input.head,
            base: input.base,
            body: input.body,
          }),
        },
      );
      if (!res.ok) throw new Error(await readGithubError(res, "create_pr"));
      return res.json();
    }
    default: {
      const _exhaustive: never = input;
      throw new Error(`unsupported github op: ${String(_exhaustive)}`);
    }
  }
}

function userFromNangoConnection(
  remote: NangoGithubConnection,
): Record<string, unknown> | null {
  const config = remote.connection_config as Record<string, unknown> | undefined;
  const userCreds = config?.userCredentials;
  if (userCreds && typeof userCreds === "object") {
    const u = userCreds as Record<string, unknown>;
    if (typeof u.login === "string") {
      return { login: u.login, source: "nango_user_credentials" };
    }
    const raw = u.raw;
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      if (typeof r.login === "string") {
        return { login: r.login, source: "nango_user_credentials" };
      }
    }
  }

  const configLogin = config?.user_login;
  if (typeof configLogin === "string") {
    return { login: configLogin, source: "nango_connection_config" };
  }

  const creds = remote.credentials as
    | { raw?: unknown; type?: string }
    | undefined;
  const raw = creds?.raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.login === "string") {
      return {
        login: r.login,
        id: r.id,
        name: r.name,
        avatar_url: r.avatar_url,
        source: "nango_credentials",
      };
    }
    const nested = r.user;
    if (nested && typeof nested === "object") {
      const u = nested as Record<string, unknown>;
      if (typeof u.login === "string") {
        return {
          login: u.login,
          id: u.id,
          name: u.name,
          avatar_url: u.avatar_url,
          source: "nango_credentials",
        };
      }
    }
  }

  const meta = remote.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.login === "string") {
    return { login: meta.login, source: "nango_metadata" };
  }

  return null;
}

function extractGithubUserAccessToken(
  remote: NangoGithubConnection,
  integrationId: string,
): string | null {
  if (isGithubAppIntegration(integrationId)) {
    const config = remote.connection_config as
      | Record<string, unknown>
      | undefined;
    const userCreds = config?.userCredentials;
    if (userCreds && typeof userCreds === "object") {
      const direct = extractAccessToken(userCreds);
      if (direct) return direct;
      const nested = (userCreds as Record<string, unknown>).credentials;
      const fromNested = extractAccessToken(nested);
      if (fromNested) return fromNested;
    }
    // APP / installation tokens cannot call GET /user or POST /user/repos.
    return null;
  }

  return extractAccessToken(remote.credentials);
}

function extractAccessToken(credentials: unknown): string | null {
  if (!credentials || typeof credentials !== "object") return null;
  const creds = credentials as Record<string, unknown>;

  if (typeof creds.access_token === "string" && creds.access_token) {
    return creds.access_token;
  }
  if (typeof creds.token === "string" && creds.token) {
    return creds.token;
  }

  const raw = creds.raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.access_token === "string" && r.access_token) {
      return r.access_token;
    }
  }

  return null;
}

function isInvalidNangoCredentials(err: unknown): boolean {
  if (
    err &&
    typeof err === "object" &&
    "response" in err &&
    err.response &&
    typeof err.response === "object" &&
    "data" in err.response &&
    err.response.data &&
    typeof err.response.data === "object" &&
    "error" in err.response.data &&
    err.response.data.error &&
    typeof err.response.data.error === "object" &&
    "code" in err.response.data.error
  ) {
    return err.response.data.error.code === "invalid_credentials";
  }
  return false;
}

async function githubFetch(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    ...init?.headers,
  };
  return fetch(url, { ...init, headers });
}

async function readGithubError(
  res: Response,
  op?: string,
): Promise<string> {
  let message = "";
  try {
    const body = (await res.json()) as { message?: string };
    message = body.message ?? "";
  } catch {
    // ignore
  }

  const base = message
    ? `GitHub API error (${res.status}): ${message}`
    : `GitHub API error (${res.status})`;

  if (
    res.status === 403 &&
    message.toLowerCase().includes("resource not accessible by integration")
  ) {
    return (
      `${base}. Moncode needs a GitHub **user OAuth token**, not an installation token. ` +
      `For github-app-oauth: enable "Request user authorization (OAuth) during installation" ` +
      `on your GitHub App, reconnect in Moncode, and confirm Nango stores userCredentials. ` +
      `Or switch Nango to the standard \`github\` OAuth integration with repo scope.`
    );
  }

  return base;
}
