/**
 * INPUT:  the Speech panel root and explicit provider/input choices.
 * OUTPUT: stable labeled native speech controls and provider request/config readers; API keys remain in password inputs.
 * POS:    experimental / lab — not in production path; plain DOM form, no persistence or automatic synthesis.
 */

import type { ProviderConfig, SpeechRequest } from "../speech/speech-provider.ts";
import { row, select, textInput } from "./controls.ts";

export interface SpeechFields {
  file: HTMLInputElement;
  provider: HTMLSelectElement;
  transport: HTMLSelectElement;
  baseUrl: HTMLInputElement;
  apiKey: HTMLInputElement;
  voice: HTMLInputElement;
  model: HTMLInputElement;
  format: HTMLSelectElement;
  speed: HTMLInputElement;
  text: HTMLTextAreaElement;
  volume: HTMLInputElement;
  gain: HTMLInputElement;
  weight: HTMLInputElement;
}

export function createSpeechFields(root: HTMLElement): SpeechFields {
  const file = input("file", "audio file");
  file.accept = "audio/*,.wav,.mp3";
  const provider = select([{ value: "openai-compatible", label: "OpenAI-compatible" }, { value: "fish-audio", label: "Fish Audio" }]);
  const transport = select(["proxy", "direct"]);
  const baseUrl = input("url", "base URL", "http://127.0.0.1:9880");
  const apiKey = input("password", "API key");
  apiKey.autocomplete = "off";
  const voice = textInput("voice", () => undefined);
  const model = textInput("model", () => undefined);
  const format = select(["wav", "mp3"]);
  const speed = numeric("speed", { value: 1, min: 0.5, max: 2, step: 0.05 });
  const text = document.createElement("textarea");
  text.rows = 3;
  const volume = numeric("volume", { value: 1, min: 0, max: 1, step: 0.05 });
  const gain = numeric("lipSyncGain", { value: 1.5, min: 0, max: 5, step: 0.1 });
  const weight = numeric("lipSyncWeight", { value: 0.4, min: 0, max: 1, step: 0.05 });
  const fields = { file, provider, transport, baseUrl, apiKey, voice, model, format, speed, text, volume, gain, weight };
  for (const [label, field] of fieldRows(fields)) {
    field.setAttribute("aria-label", label);
    row(root, label, field);
  }
  provider.addEventListener("change", () => {
    const fish = provider.value === "fish-audio";
    baseUrl.value = fish ? baseUrl.dataset.fishUrl ?? "https://api.fish.audio" : baseUrl.dataset.localUrl ?? "http://127.0.0.1:9880";
    model.value = fish ? "s2.1-pro-free" : "";
    voice.value = "";
    apiKey.value = "";
  });
  return fields;
}

function fieldRows(fields: SpeechFields): [string, HTMLElement][] {
  return [["audio file", fields.file], ["provider", fields.provider], ["transport", fields.transport], ["base URL", fields.baseUrl],
    ["API key", fields.apiKey], ["voice", fields.voice], ["model", fields.model], ["format", fields.format], ["speed", fields.speed],
    ["speech text", fields.text], ["volume", fields.volume], ["lipSyncGain", fields.gain], ["lipSyncWeight", fields.weight]];
}

function input(type: string, label: string, value = ""): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.value = value;
  el.setAttribute("aria-label", label);
  return el;
}

function numeric(label: string, spec: { value: number; min: number; max: number; step: number }): HTMLInputElement {
  const el = input("number", label, String(spec.value));
  el.min = String(spec.min);
  el.max = String(spec.max);
  el.step = String(spec.step);
  return el;
}

export function speechConfig(fields: SpeechFields): ProviderConfig { return { baseUrl: fields.baseUrl.value, apiKey: fields.apiKey.value }; }

export function speechRequest(fields: SpeechFields): SpeechRequest {
  return { text: fields.text.value, voice: fields.voice.value, model: fields.model.value,
    format: fields.format.value === "mp3" ? "mp3" : "wav", speed: fields.speed.valueAsNumber };
}

export async function loadSpeechProxyConfig(fields: SpeechFields, signal: AbortSignal): Promise<string> {
  const defaultLocal = "http://127.0.0.1:9880";
  try {
    const response = await fetch("/lab-tts/config", { signal });
    const config: unknown = await response.json();
    if (!response.ok || typeof config !== "object" || config === null || !("localBaseUrl" in config) || typeof config.localBaseUrl !== "string") return defaultLocal;
    fields.baseUrl.dataset.localUrl = config.localBaseUrl;
    fields.baseUrl.dataset.fishUrl = "fishBaseUrl" in config && typeof config.fishBaseUrl === "string" ? config.fishBaseUrl : "https://api.fish.audio";
    if (fields.provider.value === "openai-compatible" && fields.baseUrl.value === defaultLocal) fields.baseUrl.value = config.localBaseUrl;
    return config.localBaseUrl;
  } catch { return defaultLocal; }
}
