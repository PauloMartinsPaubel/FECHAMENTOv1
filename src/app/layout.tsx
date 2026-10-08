import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://fechament-ov1.vercel.app"),
  title: { default: "Fechamento de Caixa", template: "%s | Fechamento de Caixa" },
  description: "Caixa, conferência e fechamento para restaurante",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Fechamento de Caixa",
    title: "Fechamento de Caixa: o caixa do restaurante conferido em minutos",
    description: "Lance, confira e feche o caixa de cada turno sem planilha. Contagem de cédulas, alerta de diferença e relatórios. Teste grátis por 14 dias.",
  },
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
