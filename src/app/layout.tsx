import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Layer27 · 3D Printing in Mumbai with Instant Quotes", template: "%s · Layer27" },
  description: "Upload an STL and get an instant GST-ready price. FDM and 8K resin 3D printing in Mumbai, Navi Mumbai and Thane with 48-hour dispatch.",
  openGraph: { type: "website", siteName: "Layer27" },
};
export const viewport: Viewport = { themeColor: "#0b2545", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
