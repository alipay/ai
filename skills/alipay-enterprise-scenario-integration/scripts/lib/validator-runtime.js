"use strict";

const EXIT_CODES = Object.freeze({
  OK: 0,
  FAIL: 1,
  BROKEN: 2,
});

function runGuarded(name, main) {
  try {
    main();
  } catch (err) {
    const detail = err && err.stack ? err.stack : String(err);
    console.error(`[${name}] BROKEN ${detail}`);
    process.exit(EXIT_CODES.BROKEN);
  }
}

function classifySpawnResult(result) {
  if (!result) return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: "spawn returned no result" };
  if (result.error) {
    return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: `spawn failed: ${result.error.message}` };
  }
  if (result.signal) {
    return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: `terminated by signal ${result.signal}` };
  }
  if (result.status === null || result.status === undefined) {
    return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: "child exit status is unavailable" };
  }
  if (result.status === EXIT_CODES.OK) return { state: "OK", code: EXIT_CODES.OK };
  if (result.status === EXIT_CODES.FAIL) return { state: "FAIL", code: EXIT_CODES.FAIL };
  if (result.status === EXIT_CODES.BROKEN) return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: "child validator reported BROKEN" };
  return { state: "BROKEN", code: EXIT_CODES.BROKEN, reason: `unexpected child exit code ${result.status}` };
}

module.exports = {
  EXIT_CODES,
  classifySpawnResult,
  runGuarded,
};
