import type { MetadataRoute } from "next";

/** Permite instalar o sistema na tela inicial do tablet, abrindo em tela cheia como aplicativo. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fechamento de Caixa",
    short_name: "Caixa",
    start_url: "/login",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#15803d",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
