"use client";

import { useWallets } from "@privy-io/react-auth";
import { Wallet } from "lucide-react";
import { useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletBadge() {
  const { wallets, ready } = useWallets();

  const address = useMemo(() => {
    const embedded = wallets.find((w) => w.walletClientType === "privy");
    return embedded?.address ?? wallets[0]?.address;
  }, [wallets]);

  if (!ready || !address) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
            <Wallet className="size-3 shrink-0 opacity-70" />
            {truncateAddress(address)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="font-mono text-xs">{address}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
