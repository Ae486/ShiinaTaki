/**
 * INPUT:  Field instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions for the label association contract: explicit htmlFor pointing at the injected control
 *         id, hint wired through aria-describedby, invalid wired through aria-invalid.
 * POS:    unit test for components/ui/field. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Field, FIELD_CONTROL } from "./field.tsx";

describe("Field", () => {
  it("pairs the label with the control through an explicit htmlFor/id pair", () => {
    const html = renderToStaticMarkup(
      <Field label="URL">
        <input className={FIELD_CONTROL} value="" readOnly />
      </Field>,
    );
    const labelFor = /for="([^"]+)"/.exec(html)?.[1];
    expect(labelFor).toBeTruthy();
    const inputTag = /<input[^>]*>/.exec(html)?.[0] ?? "";
    expect(inputTag).toContain(`id="${labelFor}"`);
    expect(html).toContain("URL");
  });

  it("wires the hint through aria-describedby and the invalid flag through aria-invalid", () => {
    const html = renderToStaticMarkup(
      <Field label="命令" hint="可执行文件路径" invalid>
        <input className={FIELD_CONTROL} value="" readOnly />
      </Field>,
    );
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain("可执行文件路径");
    expect(html).toContain('aria-invalid="true"');
  });

  it("omits both wiring attributes when the field is valid and hint-less", () => {
    const html = renderToStaticMarkup(
      <Field label="工作目录">
        <input className={FIELD_CONTROL} value="" readOnly />
      </Field>,
    );
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid");
  });
});
