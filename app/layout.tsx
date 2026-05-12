import type { Metadata } from "next";
import "./globals.css";
import "@/components/dotmatrix-loader.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
