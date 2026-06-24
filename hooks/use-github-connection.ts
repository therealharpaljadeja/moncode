"use client";

import Nango from "@nangohq/frontend";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthFetch } from "@/hooks/use-auth-fetch";

export type GithubConnectionState = {
  connected: boolean;
  displayName: string | null;
  connectionId: string | null;
  invalid?: boolean;
  loading: boolean;
  connecting: boolean;
  error: string | null;
};

export function useGithubConnection() {
  const authFetch = useAuthFetch();
  const nangoRef = useRef<Nango | null>(null);
  const [state, setState] = useState<GithubConnectionState>({
    connected: false,
    displayName: null,
    connectionId: null,
    loading: true,
    connecting: false,
    error: null,
  });

  const getNango = useCallback(() => {
    if (!nangoRef.current) {
      nangoRef.current = new Nango();
    }
    return nangoRef.current;
  }, []);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await authFetch("/api/connections");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not load connections.");
      }
      const data = (await res.json()) as {
        connections?: Array<{
          provider: string;
          connected: boolean;
          displayName: string | null;
          connectionId: string | null;
          invalid?: boolean;
        }>;
      };
      const github = data.connections?.find((c) => c.provider === "github");
      setState((prev) => ({
        ...prev,
        connected: github?.connected ?? false,
        displayName: github?.displayName ?? null,
        connectionId: github?.connectionId ?? null,
        invalid: github?.invalid,
        loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [authFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(
    async (opts?: { reconnect?: boolean }) => {
      setState((prev) => ({ ...prev, connecting: true, error: null }));
      try {
        const res = await authFetch("/api/connections/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "github",
            reconnect: opts?.reconnect ?? false,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          sessionToken?: string;
          error?: string;
        };
        if (!res.ok || !data.sessionToken) {
          throw new Error(data.error ?? "Could not start GitHub authorization.");
        }

        await new Promise<void>((resolve, reject) => {
          const connectUi = getNango().openConnectUI({
            onEvent: (event) => {
              if (event.type === "connect") {
                resolve();
              } else if (event.type === "close") {
                reject(new Error("Authorization window closed."));
              }
            },
          });
          connectUi.setSessionToken(data.sessionToken!);
        });

        const syncRes = await authFetch("/api/connections/sync", {
          method: "POST",
        });
        if (!syncRes.ok) {
          const syncData = (await syncRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            syncData.error ??
              "GitHub authorized in Nango but Moncode could not save the connection.",
          );
        }

        await refresh();
        setState((prev) => ({ ...prev, connecting: false }));
        return true;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          connecting: false,
          error: err instanceof Error ? err.message : String(err),
        }));
        return false;
      }
    },
    [authFetch, getNango, refresh],
  );

  const disconnect = useCallback(async () => {
    setState((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const res = await authFetch("/api/connections/github", {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not disconnect GitHub.");
      }
      await refresh();
      setState((prev) => ({ ...prev, connecting: false }));
      return true;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        connecting: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return false;
    }
  }, [authFetch, refresh]);

  return {
    ...state,
    refresh,
    connect,
    disconnect,
  };
}
