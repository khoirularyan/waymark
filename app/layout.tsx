import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waymark — Live outdoor tracking",
  description: "Every journey, in sight.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
