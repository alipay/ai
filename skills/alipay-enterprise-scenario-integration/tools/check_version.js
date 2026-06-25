#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const skillDir = path.resolve(__dirname, "..");
const localMetaPath = path.join(skillDir, "skill.json");
const remoteMetaUrl = "https://raw.githubusercontent.com/alipay/ai/main/skills/alipay-enterprise-scenario-integration/skill.json";

main();

function main() {
  const local = readLocalMeta();
  fetchJson(remoteMetaUrl, (error, remote) => {
    if (error) {
      console.log(`[version-check] SKIP unable to check latest version: ${error.message}`);
      console.log(`[version-check] current version: ${local.version || "unknown"}`);
      return;
    }

    if (!remote || !remote.version) {
      console.log("[version-check] SKIP remote metadata does not contain a version");
      console.log(`[version-check] current version: ${local.version || "unknown"}`);
      return;
    }

    const cmp = compareSemver(remote.version, local.version);
    if (cmp > 0) {
      console.log("[version-check] UPDATE_AVAILABLE");
      console.log(`[version-check] current version: ${local.version || "unknown"}`);
      console.log(`[version-check] latest version: ${remote.version}`);
      console.log("[version-check] Please update the local Skill from:");
      console.log(`[version-check] ${remote.source || "https://github.com/alipay/ai/tree/main/skills/alipay-enterprise-scenario-integration"}`);
      console.log("[version-check] This script only reports version status and never updates files automatically.");
      return;
    }

    if (cmp === 0) {
      console.log(`[version-check] OK current version is up to date: ${local.version}`);
      return;
    }

    console.log(`[version-check] OK local version ${local.version} is newer than remote ${remote.version}`);
  });
}

function readLocalMeta() {
  try {
    return JSON.parse(fs.readFileSync(localMetaPath, "utf8"));
  } catch (error) {
    return { version: null };
  }
}

function fetchJson(url, callback) {
  const req = https.get(url, { headers: { "user-agent": "alipay-enterprise-scenario-skill-version-check" } }, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.resume();
      callback(new Error(`HTTP ${res.statusCode}`));
      return;
    }
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      try {
        callback(null, JSON.parse(body));
      } catch (error) {
        callback(error);
      }
    });
  });
  req.setTimeout(5000, () => {
    req.destroy(new Error("request timeout"));
  });
  req.on("error", callback);
}

function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function parseSemver(version) {
  const match = String(version || "").match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
