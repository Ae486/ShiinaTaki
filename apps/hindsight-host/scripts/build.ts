/**
 * INPUT:  checked-in Host/codec/Shared sources, the locked compiler/runtime packages and explicit release platform
 * OUTPUT: a self-contained compiled ESM installation tree with a complete SHA-256 manifest
 * POS:    hindsight-host/build — packaging only; never downloads runtimes, enrolls a Host or installs services
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import { HINDSIGHT_HOST_BUILD, HindsightHostManifestSchema } from "@taki/shared/hindsight-installation";
import { fileDigest } from "../src/installed-files.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PINS: Record<string, string> = { "libsodium-wrappers": "0.8.4", libsodium: "0.8.4", zod: "4.4.3", ws: "8.21.0", "json-rpc-2.0": "1.7.1" };
const PACKAGES = {
  "@taki/shared": "packages/shared",
  "@taki/secret-catalog-codec": "packages/secret-catalog-codec",
  "@taki/hindsight-host": "apps/hindsight-host",
} as const;
type PackageName = keyof typeof PACKAGES;
interface PackageMetadata {
  name: string; version: string; type?: string; exports?: Record<string, string>;
  dependencies?: Record<string, string>;
}

export function buildHost(options: { output: string; platform: "win32" | "linux"; architecture: "x64" | "arm64"; adapter?: string }): string {
  const output = resolve(options.output);
  if (existsSync(output)) throw new Error("release output must be a new directory");
  if (options.platform === "win32" && !options.adapter) throw new Error("Windows release requires the explicit get-only adapter artifact");
  mkdirSync(output, { recursive: true });
  const state = { output, sources: new Set<string>(), external: new Map<string, string>() };
  compileSource(state, join(ROOT, PACKAGES["@taki/hindsight-host"], "src/main.ts"));
  for (const name of Object.keys(PACKAGES) as PackageName[]) writePackage(state, name);
  for (const [name, source] of state.external) copyDependency(state, name, source);
  if (options.adapter) {
    mkdirSync(join(output, "bin"));
    copyFileSync(resolve(options.adapter), join(output, "bin/taki-secret-key.exe"));
  }
  const files = listFiles(output).map((path) => ({ path: relative(output, path).replaceAll("\\", "/"), sha256: fileDigest(path) }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = HindsightHostManifestSchema.parse({
    version: 1, build: HINDSIGHT_HOST_BUILD, platform: options.platform, architecture: options.architecture,
    entrypoint: "app/main.js", files,
  });
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return output;
}
interface BuildState { output: string; sources: Set<string>; external: Map<string, string> }

function compileSource(state: BuildState, source: string): void {
  if (state.sources.has(source)) return;
  state.sources.add(source);
  const text = readFileSync(source, "utf8");
  for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
    const target = imported.fileName;
    if (target.startsWith("node:")) continue;
    if (target.startsWith(".")) compileSource(state, resolve(dirname(source), target));
    else if (target.startsWith("@taki/")) compileSource(state, workspaceImport(target));
    else state.external.set(target, source);
  }
  const result = ts.transpileModule(text, {
    // transpileModule has no package-resolution context: NodeNext silently emits CommonJS for these .ts paths.
    // The installed package is explicitly ESM, so pin that output instead of relying on checkout metadata.
    fileName: source, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      rewriteRelativeImportExtensions: true, verbatimModuleSyntax: true, isolatedModules: true }, reportDiagnostics: true,
  });
  if (result.diagnostics?.some((entry) => entry.category === ts.DiagnosticCategory.Error)) throw new Error("release source compilation failed");
  const destination = emittedPath(state.output, source);
  mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, result.outputText, { flag: "wx" });
}

function workspaceImport(target: string): string {
  const name = target.split("/").slice(0, 2).join("/") as PackageName;
  if (!(name in PACKAGES)) throw new Error("unsupported workspace release dependency");
  const metadata = readMetadata(join(ROOT, PACKAGES[name]));
  const subpath = target === name ? "." : `.${target.slice(name.length)}`;
  const exported = metadata.exports?.[subpath];
  if (!exported) throw new Error("unsupported release export");
  return resolve(ROOT, PACKAGES[name], exported);
}
function emittedPath(output: string, source: string): string {
  for (const [name, path] of Object.entries(PACKAGES)) {
    const sourceRoot = join(ROOT, path, "src");
    const suffix = relative(sourceRoot, source);
    if (suffix.startsWith("..")) continue;
    const destination = name === "@taki/hindsight-host" ? join(output, "app") : join(output, "node_modules", name, "src");
    return join(destination, suffix.replace(/\.ts$/, ".js"));
  }
  throw new Error("release import escaped its supported sources");
}

function writePackage(state: BuildState, name: PackageName): void {
  const sourceRoot = join(ROOT, PACKAGES[name]);
  const metadata = readMetadata(sourceRoot);
  const destination = name === "@taki/hindsight-host" ? state.output : join(state.output, "node_modules", name);
  const exports = Object.fromEntries(Object.entries(metadata.exports ?? {}).filter(([, target]) => state.sources.has(resolve(sourceRoot, target)))
    .map(([key, value]) => [key, value.replace(/\.ts$/, ".js")]));
  const dependencies = Object.fromEntries(Object.keys(metadata.dependencies ?? {}).map((key) => [key, key.startsWith("@taki/") ? "0.0.0" : PINS[key]]));
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "package.json"), `${JSON.stringify({ name, version: metadata.version, type: "module", exports, dependencies }, null, 2)}\n`);
}

function copyDependency(state: BuildState, name: string, from: string): void {
  if (!PINS[name]) throw new Error("unlocked release dependency");
  const destination = join(state.output, "node_modules", name);
  if (existsSync(destination)) return;
  let source = dirname(createRequire(from).resolve(name));
  while (!existsSync(join(source, "package.json")) || readMetadata(source).name !== name) {
    const parent = dirname(source);
    if (parent === source) throw new Error("release package metadata missing");
    source = parent;
  }
  const metadata = readMetadata(source);
  if (metadata.version !== PINS[name]) throw new Error("release dependency differs from the lock");
  copyTree(source, destination);
  for (const dependency of Object.keys(metadata.dependencies ?? {})) copyDependency(state, dependency, join(source, "package.json"));
}
function copyTree(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (entry.isSymbolicLink()) throw new Error("release dependency contains a redirect");
    if (entry.isDirectory()) copyTree(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile()) copyFileSync(join(source, entry.name), join(destination, entry.name));
    else throw new Error("release dependency is not a regular file");
  }
}
function readMetadata(path: string): PackageMetadata { return JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as PackageMetadata; }
function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(join(root, entry.name)) : [join(root, entry.name)]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    output: { type: "string" }, platform: { type: "string" }, architecture: { type: "string" }, adapter: { type: "string" },
  } });
  const platform = values.platform ?? process.platform;
  const architecture = values.architecture ?? process.arch;
  if (!values.output || (platform !== "win32" && platform !== "linux") || (architecture !== "x64" && architecture !== "arm64")) throw new Error("explicit supported release output/platform required");
  buildHost({ output: values.output, platform, architecture, adapter: values.adapter });
}
