/**
 * INPUT:  labels, option lists and change handlers from the panels.
 * OUTPUT: tiny plain-DOM builders (section, row, button, select + setOptions, slider, checkbox, textInput, badge) and
 *         the PanelDeps contract every panel mount receives { host, scene, log, screen }.
 * POS:    experimental / lab — not in production path; the lab's whole UI toolkit (no React, no Tailwind — the page
 *         is a control bench, styled by lab.html).
 */

import type { LabScene } from "../scene/lab-scene.ts";

export type LogLine = (line: string) => void;

export interface PanelDeps {
  host: HTMLElement;
  scene: LabScene;
  log: LogLine;
  /** Current Pixi screen size; the scene owns the app, so panels never receive it directly. */
  screen: () => { width: number; height: number };
}

export interface SelectOption {
  value: string;
  label?: string;
}

export function section(host: HTMLElement, title: string): HTMLElement {
  const el = document.createElement("section");
  const h2 = document.createElement("h2");
  h2.textContent = title;
  el.append(h2);
  host.append(el);
  return el;
}

export function row(parent: HTMLElement, label: string, ...controls: (HTMLElement | string)[]): HTMLElement {
  const el = document.createElement("div");
  el.className = "row";
  const lab = document.createElement("label");
  lab.textContent = label;
  el.append(lab, ...controls);
  parent.append(el);
  return el;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

export function select(options: readonly (SelectOption | string)[], onChange?: (value: string) => void): HTMLSelectElement {
  const el = document.createElement("select");
  setOptions(el, options);
  if (onChange) el.addEventListener("change", () => onChange(el.value));
  return el;
}

/** Replaces the option list, keeping the current value when it is still present. */
export function setOptions(el: HTMLSelectElement, options: readonly (SelectOption | string)[]): void {
  const previous = el.value;
  el.replaceChildren();
  for (const raw of options) {
    const opt = typeof raw === "string" ? { value: raw } : raw;
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label ?? opt.value;
    el.append(o);
  }
  if (options.some((o) => (typeof o === "string" ? o : o.value) === previous)) el.value = previous;
}

export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  value: number;
}

export function slider(spec: SliderSpec, onInput: (value: number) => void): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "range";
  applySlider(el, spec);
  el.addEventListener("input", () => onInput(Number(el.value)));
  return el;
}

export function applySlider(el: HTMLInputElement, spec: SliderSpec): void {
  el.min = String(spec.min);
  el.max = String(spec.max);
  el.step = String(spec.step);
  el.value = String(spec.value);
}

export function checkbox(label: string, onChange: (checked: boolean) => void): { root: HTMLLabelElement; input: HTMLInputElement } {
  const root = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  root.append(input, ` ${label}`);
  return { root, input };
}

export function textInput(placeholder: string, onInput: (value: string) => void, listId?: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.placeholder = placeholder;
  if (listId !== undefined) el.setAttribute("list", listId);
  el.addEventListener("input", () => onInput(el.value));
  return el;
}

export function badge(text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "badge";
  el.textContent = text;
  return el;
}

export function note(parent: HTMLElement, text = ""): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "color:#9aa4b5;white-space:pre-wrap;margin:4px 0";
  el.textContent = text;
  parent.append(el);
  return el;
}
