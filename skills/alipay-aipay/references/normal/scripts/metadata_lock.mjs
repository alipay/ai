// A token-named owner file makes ownership transfer an atomic rename. Never
// recursively remove a lock: an old releaser must not delete a newer owner.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const transactionPattern = new RegExp(`^${uuid}$`, 'u');
const ownerPattern = new RegExp(`^owner-([1-9][0-9]*)-(${uuid})-(${uuid}|none)(-committed)?$`, 'u');
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function metadataLockPath(target) {
  return path.join(fs.realpathSync(path.dirname(target)), '.' + path.basename(target) + '.metadata-lock');
}

export function processIsAbsent(pid, probe = process.kill) {
  try { probe(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; } // EPERM and unknown failures are not evidence of death.
}

function ownerName({ pid, token, transaction, committed }) {
  return `owner-${pid}-${token}-${transaction || 'none'}${committed ? '-committed' : ''}`;
}

function inspectOwner(lock) {
  try {
    const stat = fs.lstatSync(lock);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { unknown: true };
    const entries = fs.readdirSync(lock);
    if (entries.length !== 1) return { unknown: true };
    const match = entries[0].match(ownerPattern);
    if (!match || !Number.isSafeInteger(Number(match[1]))) return { unknown: true };
    const ownerStat = fs.lstatSync(path.join(lock, entries[0]));
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return { unknown: true };
    return { pid: Number(match[1]), token: match[2], transaction: match[3] === 'none' ? null : match[3], committed: Boolean(match[4]) };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertOwner(lease) {
  const current = inspectOwner(lease.lock);
  if (lease.pid !== process.pid || !current || current.unknown || ownerName(current) !== ownerName(lease)) {
    throw Error('元数据锁归属已变化，保留目录并停止操作：' + lease.lock);
  }
}

export function releaseMetadataLock(lease) {
  assertOwner(lease);
  fs.unlinkSync(path.join(lease.lock, ownerName(lease)));
  // Only the process that removed its exact owner file may remove the empty
  // directory. Another stale contender cannot remove a newly acquired lock.
  fs.rmdirSync(lease.lock);
}

export function markInstallCommitted(lease) {
  assertOwner(lease);
  if (!lease.transaction) throw Error('提交安装缺少事务 ID');
  const committed = { ...lease, committed: true };
  fs.renameSync(path.join(lease.lock, ownerName(lease)), path.join(lease.lock, ownerName(committed)));
  lease.committed = true;
}

export function installTransactionPaths(target, transaction) {
  if (!transactionPattern.test(transaction || '')) throw Error('无效安装事务 ID');
  const parent = path.dirname(target);
  return { staging: path.join(parent, `.alipay-aipay-install-${transaction}`),
    backup: path.join(parent, `.alipay-aipay-backup-${transaction}`) };
}

function ordinaryDirectory(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('事务目录不是普通目录：' + file);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function recoverInstallTransaction(lease, transaction = lease.transaction) {
  assertOwner(lease);
  if (!transaction) return;
  const { staging, backup } = installTransactionPaths(lease.target, transaction);
  if (lease.committed) {
    // Backup cleanup may already have removed some old files. Once the new
    // target was verified, finish cleanup; never restore a partial backup.
    if (!ordinaryDirectory(lease.target)) throw Error('已提交安装目录不可用，保留事务：' + lease.target);
    if (ordinaryDirectory(backup)) fs.rmSync(backup, { recursive: true });
  } else if (ordinaryDirectory(backup)) {
    for (const name of ['SKILL.md', 'references/normal/scripts/self_update.mjs']) {
      const stat = fs.lstatSync(path.join(backup, name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('安装备份不可恢复，已保留：' + backup);
    }
    if (ordinaryDirectory(lease.target)) fs.rmSync(lease.target, { recursive: true });
    fs.renameSync(backup, lease.target);
  }
  if (ordinaryDirectory(staging)) fs.rmSync(staging, { recursive: true });
}

export function acquireMetadataLock(target, { transaction = null, timeoutMs = 3000 } = {}) {
  if (transaction !== null && !transactionPattern.test(transaction)) throw Error('无效安装事务 ID');
  const lock = metadataLockPath(target);
  target = path.join(path.dirname(lock), path.basename(target));
  const desired = { target, lock, pid: process.pid, token: randomUUID(), transaction };
  const started = Date.now();
  let unknown = false;
  while (true) {
    let created = false;
    try { fs.mkdirSync(lock, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (created) {
      // A crash before publication leaves an ownerless lock. Never guess who
      // owns such a directory (including locks made by older installers).
      try { fs.writeFileSync(path.join(lock, ownerName(desired)), '', { flag: 'wx', mode: 0o600 }); }
      catch (error) { try { fs.rmdirSync(lock); } catch {} throw error; }
      return desired;
    }
    const prior = inspectOwner(lock);
    unknown = Boolean(prior?.unknown);
    if (prior && !prior.unknown && processIsAbsent(prior.pid)) {
      // The filename contains the complete owner record: one rename both
      // claims the abandoned transaction and publishes our live PID/token.
      const recovered = { ...desired, transaction: prior.transaction, committed: prior.committed };
      try { fs.renameSync(path.join(lock, ownerName(prior)), path.join(lock, ownerName(recovered))); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      // Every contender repairs the abandoned transaction before starting new
      // work. A late updater therefore cannot roll back a newer installation.
      // If repair fails, retain this transaction's owner record and artifacts.
      recoverInstallTransaction(recovered);
      if (ownerName(recovered) !== ownerName(desired)) {
        fs.renameSync(path.join(lock, ownerName(recovered)), path.join(lock, ownerName(desired)));
      }
      return desired;
    }
    if (Date.now() - started >= timeoutMs) {
      const error = Error(unknown
        ? '元数据锁没有可验证的归属；请确认没有安装或元数据写入进程后，人工移走锁目录再重试：' + lock
        : '元数据锁仍被进程占用或无法确认进程已退出，请稍后重试：' + lock);
      error.code = unknown ? 'METADATA_LOCK_UNKNOWN' : 'METADATA_LOCK_BUSY';
      throw error;
    }
    pause(10);
  }
}
