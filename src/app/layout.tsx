import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fechamento de Caixa", template: "%s | Fechamento de Caixa" },
  description: "Caixa, conferência e fechamento para restaurante",
  robots: { index: false, follow: false },
  applicationName: "Fechamento de Caixa",
  appleWebApp: { capable: true, title: "Caixa", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#15803d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
