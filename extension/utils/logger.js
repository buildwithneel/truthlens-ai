/**
 * TruthLens AI – Logger Utility
 *
 * A tiny, level-aware console wrapper so every TruthLens log line is
 * prefixed and can be silenced in production without touching call-sites.
 *
 * Usage:
 *   TLLogger.info('VideoSource', 'stream attached');
 *   TLLogger.warn('FaceDetector', 'no faces found');
 *   TLLogger.error('InferenceProvider', 'predict failed', err);
 *   TLLogger.debug('RiskEngine', 'raw score', 0.42);
 */

'use strict';

const TLLogger = (() => {
  // ── Log levels (higher number = more severe) ───────────────────────────
  const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 99 };

  // Change this to LEVELS.NONE to silence all logs in production.
  let _currentLevel = LEVELS.DEBUG;

  const PREFIX = '[TruthLens]';

  // ── Formatters ─────────────────────────────────────────────────────────
  function _format(module, ...args) {
    return [`${PREFIX}[${module}]`, ...args];
  }

  // ── Public API ─────────────────────────────────────────────────────────
  return {
    /**
     * Set the minimum log level.
     * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'|'NONE'} level
     */
    setLevel(level) {
      if (LEVELS[level] == null) {
        console.warn(PREFIX, `Unknown log level: "${level}". Ignoring.`);
        return;
      }
      _currentLevel = LEVELS[level];
    },

    debug(module, ...args) {
      if (_currentLevel <= LEVELS.DEBUG) {
        console.debug(..._format(module, ...args));
      }
    },

    info(module, ...args) {
      if (_currentLevel <= LEVELS.INFO) {
        console.info(..._format(module, ...args));
      }
    },

    warn(module, ...args) {
      if (_currentLevel <= LEVELS.WARN) {
        console.warn(..._format(module, ...args));
      }
    },

    error(module, ...args) {
      if (_currentLevel <= LEVELS.ERROR) {
        console.error(..._format(module, ...args));
      }
    },

    LEVELS,
  };
})();

// Make TLLogger available as a global so all subsequently-loaded content
// scripts can use it without an import statement (content scripts share
// the same page JS scope when injected via manifest content_scripts).
window.TLLogger = TLLogger;
