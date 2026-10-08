import type { Metadata, Viewport } from "next";
import PwaRegister from "./pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Command Center — Mustafa’s 15-Day Reset",
  description: "A private space for Mustafa’s daily routine and progress.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = { themeColor: "#376e50" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-full flex flex-col"><PwaRegister />{children}</body>
    </html>
  );
}
