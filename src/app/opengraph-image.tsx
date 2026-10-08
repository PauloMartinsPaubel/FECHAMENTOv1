import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// imagem que aparece quando alguém compartilha o link (WhatsApp, Instagram, e-mail)
export const alt = "Fechamento de Caixa: o caixa de cada turno conferido e fechado em minutos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const shot = await readFile(join(process.cwd(), "public/apresentacao/lancamentos.png"));
  const src = `data:image/png;base64,${shot.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#123B26", color: "#F6F4EE", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 0 0 64px", width: 560, gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "#15803D", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>R$</div>
            <div style={{ fontSize: 30 }}>Fechamento de Caixa</div>
          </div>
          <div style={{ fontSize: 54, lineHeight: 1.1 }}>O caixa de cada turno conferido e fechado em minutos.</div>
          <div style={{ fontSize: 26, color: "#BFD8C8" }}>Para restaurantes. Teste grátis por 14 dias.</div>
        </div>
        <img src={src} width={760} height={507} style={{ position: "absolute", left: 600, top: 70, borderRadius: 16, border: "6px solid #2B5A40" }} />
      </div>
    ),
    size,
  );
}
