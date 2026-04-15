import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageDirectory, "..", "..");
const rootPackageJsonPath = resolve(repositoryRoot, "package.json");
const versionFilePath = resolve(packageDirectory, "src", "app-version.ts");

const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));

if (typeof rootPackageJson.version !== "string" || !rootPackageJson.version) {
  throw new Error("Root package.json must define a version string.");
}

writeFileSync(
  versionFilePath,
  `export const appVersion = "${rootPackageJson.version}";\n`,
);
