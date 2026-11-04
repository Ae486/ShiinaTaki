/**
 * INPUT:  an optional models.dev provider logo URL and its readable provider name.
 * OUTPUT: ModelProviderLogo — remote brand artwork or a local generic symbol after an absent/failed image.
 * POS:    Home Settings presentation — plain image loading; no external SVG markup or model identity inference.
 */
import { useState } from "react";
import { Glyph } from "@/lib/icons/glyph.js";

type ModelProviderLogoProps = { logoUrl: string | null; providerName: string | null };

export function ModelProviderLogo({ logoUrl, providerName }: ModelProviderLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (logoUrl && logoUrl !== failedUrl) {
    return <img src={logoUrl} alt={`${providerName ?? "模型提供方"}标识`} width={32} height={32}
      className="h-8 w-8 shrink-0 rounded object-contain" referrerPolicy="no-referrer" decoding="async"
      onError={() => setFailedUrl(logoUrl)} />;
  }
  return <span role="img" aria-label="通用模型图标" className="flex h-8 w-8 shrink-0 items-center justify-center">
    <Glyph className="h-6 w-6"><rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3" />
      <circle cx="12" cy="12" r="2.5" /></Glyph>
  </span>;
}
