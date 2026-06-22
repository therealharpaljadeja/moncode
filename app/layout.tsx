import type { Metadata } from "next";
import "./globals.css";

import { PrivyAuthProvider } from "@/components/providers/privy-provider";

export const metadata: Metadata = {
  title: "Moncode",
  description: "Vibe-code Monad dApps in a sandbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <PrivyAuthProvider>{children}</PrivyAuthProvider>
      </body>
    </html>
  );
}
