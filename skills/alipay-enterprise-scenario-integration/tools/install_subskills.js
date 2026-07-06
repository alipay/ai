#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const skillDir = path.resolve(__dirname, "..");
const subskillsDir = path.join(skillDir, "subskills");
const domains = [
  "alipay-enterprise-ec",
  "alipay-enterprise-expense-control",
  "alipay-enterprise-bill",
];
const optionalDomains = new Set([
  "alipay-third-party-withholding",
]);

function main() {
  let options;
  let skillsRoot;
  const staged = [];
  const installed = [];

  try {
    options = parseArgs(process.argv.slice(2));
    skillsRoot = path.resolve(options.skillsRoot || path.dirname(skillDir));
    fs.mkdirSync(skillsRoot, { recursive: true });

    const selectedDomains = [...domains, ...options.withDomains];
    assertNoRootExtraction(skillsRoot, selectedDomains);
    for (const domain of selectedDomains) {
      const destination = path.join(skillsRoot, domain);
      if (isInstalled(destination)) {
        console.log(`[install-subskills] OK ${domain}: already installed`);
        continue;
      }
      if (fs.existsSync(destination)) {
        throw new Error(`${domain} destination exists but is incomplete: ${destination}`);
      }
      if (options.checkOnly) {
        throw new MissingError(`${domain} is not installed under ${skillsRoot}`);
      }

      const zipPath = path.join(subskillsDir, `${domain}.zip`);
      validateZip(zipPath, domain);
      const tempParent = fs.mkdtempSync(path.join(skillsRoot, `.subskills-${domain}-`));
      const stagedDir = path.join(tempParent, domain);
      fs.mkdirSync(stagedDir);
      extractZip(zipPath, stagedDir);
      validateExtracted(stagedDir, domain);
      staged.push({ domain, tempParent, stagedDir, destination });
    }

    if (options.checkOnly) {
      console.log("[install-subskills] OK all domain skills installed");
      return;
    }

    for (const item of staged) {
      fs.renameSync(item.stagedDir, item.destination);
      installed.push(item);
      fs.rmSync(item.tempParent, { recursive: true, force: true });
      console.log(`[install-subskills] installed ${item.domain} -> ${item.destination}`);
    }
    console.log("[install-subskills] OK all domain skills ready");
  } catch (err) {
    for (const item of installed.reverse()) {
      fs.rmSync(item.destination, { recursive: true, force: true });
    }
    for (const item of staged) {
      fs.rmSync(item.tempParent, { recursive: true, force: true });
    }
    const code = err instanceof MissingError ? 1 : 2;
    console.error(`[install-subskills] ${code === 1 ? "MISSING" : "BROKEN"} ${err.message}`);
    process.exit(code);
  }
}

function parseArgs(args) {
  const options = { checkOnly: false, skillsRoot: null, withDomains: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") {
      options.checkOnly = true;
    } else if (args[i] === "--skills-root" && args[i + 1]) {
      options.skillsRoot = args[++i];
    } else if (args[i] === "--with" && args[i + 1]) {
      const domain = args[++i];
      if (!optionalDomains.has(domain)) throw new Error(`unknown optional domain: ${domain}`);
      if (!options.withDomains.includes(domain)) options.withDomains.push(domain);
    } else {
      throw new Error(`unknown argument: ${args[i]}`);
    }
  }
  return options;
}

function validateZip(zipPath, domain) {
  if (!fs.existsSync(zipPath)) throw new Error(`bundled zip is missing: ${zipPath}`);
  const result = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  if (result.error) throw new Error(`unable to run unzip: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`unable to inspect ${domain}.zip: ${result.stderr || result.stdout}`);

  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.includes("SKILL.md") || !entries.includes("scripts/validate_codegen.js")) {
    throw new Error(`${domain}.zip does not contain required Skill files at the archive root`);
  }
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`${domain}.zip contains unsafe path: ${entry}`);
    }
  }
}

function assertNoRootExtraction(skillsRoot, selectedDomains) {
  const rootSkillMd = path.join(skillsRoot, "SKILL.md");
  if (!fs.existsSync(rootSkillMd)) return;

  const text = fs.readFileSync(rootSkillMd, "utf8");
  const match = text.match(/^name:\s*([^\s]+)/m);
  const skillName = match && match[1].trim();
  if (!skillName || !selectedDomains.includes(skillName)) return;

  throw new Error(
    [
      `${skillName} appears to be extracted directly into the Skills root: ${skillsRoot}`,
      `Expected location: ${path.join(skillsRoot, skillName, "SKILL.md")}`,
      "Remove the root-level SKILL.md/scripts/references files that belong to that skill,",
      "then rerun this installer. Do not unzip subskills/*.zip into the Skills root.",
    ].join(" ")
  );
}

function extractZip(zipPath, destination) {
  const result = spawnSync("unzip", ["-q", zipPath, "-d", destination], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.error) throw new Error(`unable to run unzip: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`failed to extract ${zipPath}: ${result.stderr || result.stdout}`);
}

function validateExtracted(dir, domain) {
  if (!isInstalled(dir)) throw new Error(`${domain} extraction is incomplete`);
  for (const file of walk(dir)) {
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`${domain} extraction contains a symbolic link: ${path.relative(dir, file)}`);
    }
  }
}

function isInstalled(dir) {
  return fs.existsSync(path.join(dir, "SKILL.md"))
    && fs.existsSync(path.join(dir, "scripts", "validate_codegen.js"));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? [full, ...walk(full)] : [full];
  });
}

class MissingError extends Error {}

main();
