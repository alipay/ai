"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT_RELATIVE_PATH = path.join(".alipay-skill", "integration-contract.json");
const SOURCE_EXTENSIONS = /\.(?:java|js|cjs|mjs|ts|py|go|cs|php|rb)$/i;

function validateIntegrationContract(targetDir, domains, errors) {
  const contractFile = path.join(targetDir, CONTRACT_RELATIVE_PATH);
  if (!fs.existsSync(contractFile)) {
    if (process.env.ALIPAY_PROJECT_MODE === "existing") {
      errors.push(`existing-project validation requires ${CONTRACT_RELATIVE_PATH}`);
    }
    return;
  }

  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractFile, "utf8"));
  } catch (err) {
    errors.push(`${CONTRACT_RELATIVE_PATH} is not valid JSON: ${err.message}`);
    return;
  }

  if (contract.projectMode !== "existing") {
    if (process.env.ALIPAY_PROJECT_MODE === "existing") {
      errors.push(`${CONTRACT_RELATIVE_PATH} projectMode must be existing`);
    }
    return;
  }
  if (contract.schemaVersion !== 1) {
    errors.push(`${CONTRACT_RELATIVE_PATH} must use schemaVersion 1`);
  }

  const unresolved = Array.isArray(contract.gaps)
    ? contract.gaps.filter((gap) => gap && gap.status === "NEEDS_USER_CONFIRM")
    : [];
  if (unresolved.length) {
    errors.push(`${CONTRACT_RELATIVE_PATH} still contains ${unresolved.length} NEEDS_USER_CONFIRM gap(s)`);
  }

  for (const domain of domains) validateDomain(targetDir, contract, domain, errors);
}

function validateDomain(targetDir, contract, domain, errors) {
  const domainContract = contract.domains && contract.domains[domain];
  if (!domainContract) {
    errors.push(`${CONTRACT_RELATIVE_PATH} is missing domains.${domain} for existing-project integration`);
    return;
  }

  if (!["CONFIRMED", "NOT_APPLICABLE"].includes(domainContract.status)) {
    errors.push(`${CONTRACT_RELATIVE_PATH} domains.${domain}.status must be CONFIRMED or NOT_APPLICABLE`);
  }

  for (const joinPoint of arrayOf(domainContract.joinPoints)) {
    if (!joinPoint.capability || !joinPoint.strategy) {
      errors.push(`${CONTRACT_RELATIVE_PATH} domains.${domain}.joinPoints entries require capability and strategy`);
      continue;
    }
    if (joinPoint.status !== "CONFIRMED") {
      errors.push(`${CONTRACT_RELATIVE_PATH} join point ${domain}:${joinPoint.capability} is not CONFIRMED`);
    }
    validateEvidence(targetDir, domain, joinPoint, errors);
  }

  for (const change of arrayOf(domainContract.changes)) {
    if (!change.path || !["add", "modify", "reuse", "delete"].includes(change.action)) {
      errors.push(`${CONTRACT_RELATIVE_PATH} domains.${domain}.changes entries require path and action`);
      continue;
    }
    if (change.action !== "delete") validateProjectPath(targetDir, change.path, `${domain} change`, errors);
  }
}

function validateEvidence(targetDir, domain, joinPoint, errors) {
  const evidenceFiles = arrayOf(joinPoint.evidenceFiles);
  const symbols = arrayOf(joinPoint.symbols);
  if (evidenceFiles.length === 0 && symbols.length === 0) {
    errors.push(`${CONTRACT_RELATIVE_PATH} join point ${domain}:${joinPoint.capability} requires evidenceFiles or symbols`);
    return;
  }

  const texts = [];
  for (const file of evidenceFiles) {
    const resolved = validateProjectPath(targetDir, file, `${domain} join point evidence`, errors);
    if (resolved && fs.statSync(resolved).isFile() && SOURCE_EXTENSIONS.test(resolved)) {
      texts.push(fs.readFileSync(resolved, "utf8"));
    }
  }
  if (symbols.length === 0) return;

  const haystack = texts.length ? texts.join("\n") : readSourceText(targetDir);
  for (const symbol of symbols) {
    if (!haystack.includes(symbol)) {
      errors.push(`${CONTRACT_RELATIVE_PATH} join point ${domain}:${joinPoint.capability} references missing symbol ${symbol}`);
    }
  }
}

function validateProjectPath(targetDir, relativePath, label, errors) {
  const resolved = path.resolve(targetDir, relativePath);
  const root = `${path.resolve(targetDir)}${path.sep}`;
  if (resolved !== path.resolve(targetDir) && !resolved.startsWith(root)) {
    errors.push(`${CONTRACT_RELATIVE_PATH} ${label} escapes the project directory: ${relativePath}`);
    return null;
  }
  if (!fs.existsSync(resolved)) {
    errors.push(`${CONTRACT_RELATIVE_PATH} ${label} does not exist: ${relativePath}`);
    return null;
  }
  return resolved;
}

function readSourceText(dir) {
  return walk(dir)
    .filter((file) => SOURCE_EXTENSIONS.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "target", "dist", "build", "vendor", "bin", "obj"].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  CONTRACT_RELATIVE_PATH,
  validateIntegrationContract,
};
