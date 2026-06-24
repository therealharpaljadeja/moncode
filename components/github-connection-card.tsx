"use client";

import { GitBranch, Link2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useGithubConnection } from "@/hooks/use-github-connection";
import { cn } from "@/lib/utils";

type GithubConnectionCardProps = {
  variant?: "page" | "chat";
  reason?: string;
  onConnected?: () => void;
  className?: string;
};

export function GithubConnectionCard({
  variant = "page",
  reason,
  onConnected,
  className,
}: GithubConnectionCardProps) {
  const {
    connected,
    displayName,
    invalid,
    loading,
    connecting,
    error,
    connect,
    disconnect,
  } = useGithubConnection();

  const handleConnect = async () => {
    const ok = await connect();
    if (ok) onConnected?.();
  };

  const isChat = variant === "chat";

  return (
    <Card
      className={cn(
        isChat && "border-primary/30 bg-primary/5 shadow-none",
        className,
      )}
    >
      <CardHeader className={cn(isChat && "p-4 pb-2")}>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <GitBranch className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className={cn("text-base", isChat && "text-sm")}>
              {connected && !invalid
                ? "GitHub connected"
                : invalid
                  ? "Reconnect GitHub"
                  : "Connect GitHub"}
            </CardTitle>
            <p className={cn("text-sm text-muted-foreground", isChat && "text-xs")}>
              {reason ??
                (invalid
                  ? "Your GitHub credentials need refreshing. Use Reconnect to open GitHub authorization. If you are stuck on an already-installed app page, use Revoke access first."
                  : connected
                    ? `Signed in as ${displayName ?? "your GitHub account"}. The agent can create repos, push code, and open pull requests.`
                    : "Disconnect only unlinks Moncode — your GitHub app install stays. Click Connect to restore instantly if you have not revoked access.")}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-3", isChat && "p-4 pt-0")}>
        {error && (
          <p className="text-sm text-destructive-foreground">{error}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <Button disabled size={isChat ? "sm" : "default"}>
              <Spinner className="mr-2 size-4" />
              Checking connection…
            </Button>
          ) : connected && !invalid ? (
            <>
              <Button
                variant="outline"
                size={isChat ? "sm" : "default"}
                disabled={connecting}
                onClick={() => void disconnect()}
              >
                {connecting ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <Unlink className="mr-2 size-4" />
                )}
                Disconnect
              </Button>
              {!isChat && (
                <Button
                  variant="ghost"
                  size="default"
                  disabled={connecting}
                  onClick={() => void disconnect({ revoke: true })}
                  className="text-muted-foreground"
                >
                  Revoke access
                </Button>
              )}
              {invalid && (
                <Button
                  size={isChat ? "sm" : "default"}
                  disabled={connecting}
                  onClick={() => void handleConnect()}
                >
                  {connecting ? (
                    <Spinner className="mr-2 size-4" />
                  ) : (
                    <Link2 className="mr-2 size-4" />
                  )}
                  Reconnect
                </Button>
              )}
            </>
          ) : (
            <Button
              size={isChat ? "sm" : "default"}
              disabled={connecting}
              onClick={() => void handleConnect()}
            >
              {connecting ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Link2 className="mr-2 size-4" />
              )}
              {invalid ? "Reconnect GitHub" : "Connect GitHub"}
            </Button>
          )}
          {connected && invalid && (
            <Button
              size={isChat ? "sm" : "default"}
              disabled={connecting}
              onClick={() => void handleConnect()}
            >
              {connecting ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Link2 className="mr-2 size-4" />
              )}
              Reconnect GitHub
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
