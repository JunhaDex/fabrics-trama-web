import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "trama",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="h-full bg-surface text-on-surface">{children}</body>
    </html>
  );
}
