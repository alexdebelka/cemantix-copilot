import type { Metadata } from "next";
import { Spectral, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Cémantix · co-pilote",
  description:
    "Suggère des mots pour Cémantix ; vous jouez à la main et rapportez la température. Tout reste dans votre navigateur.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${spectral.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
