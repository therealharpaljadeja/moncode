"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, Plug } from "lucide-react";
import Link from "next/link";

import { AuthGate } from "@/components/auth-gate";
import { GithubConnectionCard } from "@/components/github-connection-card";
import { WalletBadge } from "@/components/wallet-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ConnectionsPage() {
  return (
    <AuthGate>
      <ConnectionsContent />
    </AuthGate>
  );
}

function ConnectionsContent() {
  const { logout } = usePrivy();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center gap-3 border-b px-6">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
        >
          <Link href="/" aria-label="Back to projects">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-2 font-semibold">
          <Plug className="size-4 text-muted-foreground" />
          Connections
        </div>
        <div className="flex-1" />
        <WalletBadge />
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-8 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Connected accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            Link services once and the Moncode agent can use them across all
            your projects — create repos, push code, and open pull requests on
            GitHub when you ask.
          </p>
        </div>

        <div className="space-y-4">
          <GithubConnectionCard variant="page" />

          <Card className="border-dashed bg-muted/20">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                More integrations coming soon
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Linear, Slack, and deployment targets will appear here as
                Moncode grows.
              </p>
            </CardHeader>
            <CardContent />
          </Card>
        </div>
      </main>
    </div>
  );
}
