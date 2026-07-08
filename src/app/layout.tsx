import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat with a Website",
  description: "Crawl a website and chat with its content, grounded with citations."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
