"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.replace("/");
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(167,139,250,0.12),_transparent_55%)]"
      />
      <div className="relative w-full max-w-sm space-y-8 text-center">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Moncode
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to build
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Log in or create an account to vibe-code Monad dApps.
          </p>
        </div>

        <div className="space-y-3">
          <Button className="w-full" size="lg" onClick={() => login()}>
            Continue with email
          </Button>
          <p className="text-xs text-muted-foreground">
            Sign in or create an account with your email
          </p>
        </div>
      </div>
    </div>
  );
}
