#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(scriptDir, '../json/managed-jq-assets.json');
const internalPrefix = 'ALIPAY_AIPAY_INTERNAL:JQ_PREPARE=';

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (
    parsed?.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+$/u.test(parsed.version || '') ||
    !Number.isInteger(parsed.downloadTimeoutMs) || parsed.downloadTimeoutMs <= 0 ||
    !Number.isInteger(parsed.idleTimeoutMs) || parsed.idleTimeoutMs <= 0 ||
    !Number.isInteger(parsed.maxBytes) || parsed.maxBytes <= 0 ||
    !Number.isInteger(parsed.maxRedirects) || parsed.maxRedirects < 0 ||
    !parsed.assets || typeof parsed.assets !== 'object' || Array.isArray(parsed.assets)
  ) {
    throw new Error('managed jq 资产清单非法');
  }
  return Object.freeze(parsed);
}

export const managedJqManifest = readManifest();

export function managedJqPath(homeDir = process.env.HOME || os.homedir()) {
  if (!path.isAbsolute(homeDir) || path.resolve(homeDir) === path.parse(homeDir).root) {
    throw new Error('jq 用户安装目录必须位于绝对 Home 路径下');
  }
  return path.join(path.resolve(homeDir), '.local', 'bin', 'jq');
}

export function resolveManagedJqAsset(platform = process.platform, arch = process.arch) {
  const asset = managedJqManifest.assets[`${platform}-${arch}`];
  return asset ? Object.freeze({ ...asset, version: managedJqManifest.version }) : null;
}

export async function checkManagedJqAtPath(jqPath, expectedVersion = managedJqManifest.version) {
  try {
    const { stdout } = await execFileAsync(jqPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    const version = String(stdout).trim().replace(/^jq-/u, '');
    if (version !== expectedVersion) return { installed: false };
    const { stdout: smokeOutput } = await execFileAsync(
      jqPath,
      ['-n', '-c', '--arg', 'value', 'ok', '{value:$value}'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    if (String(smokeOutput).trim() !== '{"value":"ok"}') return { installed: false };
    return { installed: true, version, path: jqPath };
  } catch {
    return { installed: false };
  }
}

function assertAllowedDownloadUrl(value) {
  const url = new URL(value);
  const githubHost = url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com');
  if (url.protocol !== 'https:' || !githubHost || url.username || url.password) {
    throw new Error('jq 下载地址未通过 GitHub HTTPS 白名单校验');
  }
  return url;
}

function downloadBuffer(
  urlValue,
  deadline = Date.now() + managedJqManifest.downloadTimeoutMs,
  redirectCount = 0
) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = assertAllowedDownloadUrl(urlValue);
    } catch (error) {
      reject(error);
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error(`jq 下载超过 ${managedJqManifest.downloadTimeoutMs / 1000} 秒`));
      return;
    }

    let settled = false;
    const request = https.get(url, { headers: { 'User-Agent': 'alipay-aipay-jq-installer' } });
    const totalTimer = setTimeout(() => {
      request.destroy(new Error(`jq 下载超过 ${managedJqManifest.downloadTimeoutMs / 1000} 秒`));
    }, remaining);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      reject(error);
    }

    request.setTimeout(Math.min(managedJqManifest.idleTimeoutMs, remaining), () => {
      request.destroy(new Error(`jq 下载连续 ${managedJqManifest.idleTimeoutMs / 1000} 秒无响应`));
    });

    request.on('response', (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        clearTimeout(totalTimer);
        settled = true;
        if (redirectCount >= managedJqManifest.maxRedirects) {
          reject(new Error('jq 下载重定向次数过多'));
          return;
        }
        downloadBuffer(new URL(location, url).toString(), deadline, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new Error(`jq 下载返回 HTTP ${status || 'UNKNOWN'}`));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > managedJqManifest.maxBytes) {
        response.resume();
        fail(new Error('jq 下载文件超过大小上限'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > managedJqManifest.maxBytes) {
          response.destroy(new Error('jq 下载文件超过大小上限'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        resolve(Buffer.concat(chunks));
      });
      response.on('error', fail);
    });
    request.on('error', fail);
  });
}

export async function installManagedJqAsset(asset, targetPath, downloader = downloadBuffer) {
  const targetDir = path.dirname(targetPath);
  const tempPath = path.join(targetDir, `.jq-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
  await fsp.mkdir(targetDir, { recursive: true, mode: 0o700 });
  try {
    const body = await downloader(asset.url);
    const digest = createHash('sha256').update(body).digest('hex');
    if (digest !== asset.sha256) throw new Error('jq 下载文件 SHA-256 校验失败');
    await fsp.writeFile(tempPath, body, { flag: 'wx', mode: 0o700 });
    await fsp.chmod(tempPath, 0o755);
    const check = await checkManagedJqAtPath(tempPath, asset.version);
    if (!check.installed) throw new Error('jq 用户级文件版本或 JSON 功能验证失败');
    await fsp.rename(tempPath, targetPath);
    return { ...check, path: targetPath };
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function prepareManagedJq(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const asset = resolveManagedJqAsset(platform, arch);
  if (!asset) return { status: 'UNSUPPORTED', platform, arch };
  const targetPath = managedJqPath(options.homeDir);
  const existing = await checkManagedJqAtPath(targetPath, asset.version);
  if (existing.installed) return { status: 'READY', source: 'EXISTING', ...existing };
  const installed = await installManagedJqAsset(asset, targetPath, options.downloader);
  return { status: 'READY', source: 'INSTALLED', ...installed };
}

export async function runManagedJqCli(argv = process.argv) {
  if (argv.length !== 3 || argv[2] !== 'prepare') throw new Error('用法: managed_jq.mjs prepare');
  try {
    const result = await prepareManagedJq();
    process.stderr.write(`${internalPrefix}${result.status}\n`);
    return result.status === 'READY' ? 0 : 2;
  } catch {
    process.stderr.write(`${internalPrefix}FAILED\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagedJqCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${internalPrefix}FAILED\n`);
    process.exitCode = 1;
  });
}
