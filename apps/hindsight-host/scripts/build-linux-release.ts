/**
 * INPUT:  explicit new output directory and supported Linux architecture; only locally locked dependencies
 * OUTPUT: payload plus the separately protected builtin launcher and systemd unit installation templates
 * POS:    hindsight-host/build — Linux distribution packaging; never provisions credentials or enables a service
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildHost } from "./build.ts";

const { values } = parseArgs({ options: { output: { type: "string" }, architecture: { type: "string" } } });
if (!values.output || (values.architecture !== "x64" && values.architecture !== "arm64")) throw new Error("explicit output and Linux architecture required");
const output = resolve(values.output);
if (existsSync(output)) throw new Error("release output must be a new directory");
mkdirSync(output, { recursive: true });
buildHost({ output: join(output, "payload"), platform: "linux", architecture: values.architecture });
const packaging = resolve(dirname(fileURLToPath(import.meta.url)), "../packaging");
for (const file of ["launcher.mjs", "taki-hindsight-host.service"]) copyFileSync(join(packaging, file), join(output, file));
