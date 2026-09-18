/**
 * INPUT:  PanelDeps, explicit local-file selection and provider form submissions.
 * OUTPUT: native speech controls and a typed snapshot/disposer; native engine playback is the only audio output.
 * POS:    experimental / lab — not in production path; no automatic external request or persistent API key storage.
 */

import { createFishAudioProvider } from "../speech/fish-audio-provider.ts";
import { createOpenAiSpeechProvider } from "../speech/openai-compatible-provider.ts";
import { createTransport } from "../speech/transport.ts";
import { button, type PanelDeps, row, section } from "./controls.ts";
import { mountMouthControls } from "./mouth-controls.ts";
import { createSpeechActions, type SpeechPanelSnapshot } from "./speech-actions.ts";
import { createSpeechFields, loadSpeechProxyConfig, speechConfig, speechRequest } from "./speech-fields.ts";
import { renderSpeechSnapshot, updateSpeechButtons } from "./speech-readout.ts";

export interface SpeechPanel {
  snapshot(): SpeechPanelSnapshot;
  dispose(): void;
}

export function mountPanelSpeech({ host, scene, log, screen }: PanelDeps): SpeechPanel {
  const root = section(host, "Speech");
  const fields = createSpeechFields(root);
  const actions = createSpeechActions(scene, log);
  const configAbort = new AbortController();
  let localBaseUrl = "http://127.0.0.1:9880";
  void loadSpeechProxyConfig(fields, configAbort.signal).then((url) => { localBaseUrl = url; });
  const synthesize = button("Synthesize", () => {
    const transport = createTransport(fields.transport.value === "direct" ? "direct" : "proxy", localBaseUrl);
    const config = speechConfig(fields);
    const provider = fields.provider.value === "fish-audio" ? createFishAudioProvider(config, transport) : createOpenAiSpeechProvider(config, transport);
    void actions.synthesize(provider, speechRequest(fields));
  });
  const play = button("Play loaded clip", () => void actions.play());
  const stop = button("Stop speech", () => actions.stop());
  const resume = button("Resume audio", () => void actions.resume());
  row(root, "", synthesize);
  row(root, "", play, stop);
  row(root, "", resume);
  fields.file.addEventListener("change", () => { const file = fields.file.files?.[0]; if (file) void actions.loadFile(file); });
  const configure = (): void => actions.configure({ volume: fields.volume.valueAsNumber, gain: fields.gain.valueAsNumber, weight: fields.weight.valueAsNumber });
  for (const field of [fields.volume, fields.gain, fields.weight]) field.addEventListener("input", configure);
  configure();
  const unmountMouth = mountMouthControls(root, { actions, fields, scene, screen });
  const readout = document.createElement("pre");
  readout.setAttribute("aria-label", "speech readout");
  root.append(readout);
  const refresh = (): void => {
    const snapshot = actions.snapshot();
    readout.textContent = renderSpeechSnapshot(snapshot);
    updateSpeechButtons({ synthesize, play, stop, resume, file: fields.file }, snapshot);
  };
  refresh();
  const timer = setInterval(refresh, 100);
  return { snapshot: () => actions.snapshot(), dispose: () => {
    clearInterval(timer); configAbort.abort(); unmountMouth(); actions.dispose(); fields.apiKey.value = "";
  } };
}
