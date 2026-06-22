"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";

export function useAuthFetch() {
  const { getAccessToken } = usePrivy();

  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const token = await getAccessToken();
      const headers = new Headers(init?.headers);
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    },
    [getAccessToken],
  );
}
