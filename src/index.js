const fs = require("fs");
const path = require("path");
const TouchPortalClient = require("./touchportalClient");
const { pathToFileURL } = require("url");
const { YtmDesktopApi } = require("./ytmApi");

const PLUGIN_ID = "com.hellblazer90.ytmdesktop.v2";
const LOG_PREFIX = "YTM V2";
const CONNECTOR_PREFIX = "pc";
const RECONNECT_INTERVAL_MS = 5000;
const ACTION_DEBOUNCE_MS = 250;
const ACTION_DUPLICATE_WINDOW_MS = 300;
const MIN_POLL_INTERVAL_MS = 6000;
const MIN_STATE_INTERVAL_MS = 6000;
const RATE_LIMIT_BACKOFF_MS = 10000;
const TOKEN_WATCH_INTERVAL_MS = 3000;
const COMMAND_MIN_INTERVAL_MS = 600;
const COMMAND_BACKOFF_MS = 2000;
const TOGGLE_DEBOUNCE_MS = ACTION_DEBOUNCE_MS;
const DEFAULT_STATE_REPLAY_MS = 0;
const DEFAULT_ELAPSED_TICK_MS = 500;
const SETTINGS_LOG_THROTTLE_MS = 2000;
const STATUS_SETTING_REFRESH_MS = 1500;
const VOLUME_SLIDER_DEBOUNCE_MS = 120;
const COVER_ART_FILENAME = "ytmd_cover_art.jpg";
const COVER_ART_ALT_FILENAME = "ytmd_cover_art_alt.jpg";
const COVER_ART_TIMEOUT_MS = 8000;
const COVER_ART_DEFAULT_MAX_WIDTH = 512;
const COVER_ART_ALLOWED_WIDTHS = [64, 128, 256, 512];
const COVER_ART_BASE64_MIN_INTERVAL_MS = 1500;
const COVER_ART_DEFAULT_MAX_BASE64_LENGTH = 0;

const SETTINGS = {
  hostname: "ytmd.hostname",
  port: "ytmd.port",
  authToken: "ytmd.authToken",
  pollIntervalMs: "ytmd.pollIntervalMs",
  coverDownloadEnabled: "ytmd.coverDownloadEnabled",
  coverArtMaxWidth: "ytmd.coverArtMaxWidth",
  coverArtMaxBase64Length: "ytmd.coverArtMaxBase64Length",
  elapsedTickMs: "ytmd.elapsedTickMs",
  stateReplayMs: "ytmd.stateReplayMs",
  elapsedDurationEnabled: "ytmd.elapsedDurationEnabled",
  minimalStateMode: "ytmd.minimalStateMode",
  extendedStatesEnabled: "ytmd.extendedStatesEnabled"
};

const SETTINGS_LABELS = {
  hostname: "Companion Server Hostname (Advanced, usually 127.0.0.1)",
  port: "Companion Server Port (from YTM Desktop, default 9863)",
  authToken: "Companion Token (from Generate Token)",
  pollIntervalMs: "Poll Interval (ms) (Advanced, >=6000)",
  coverDownloadEnabled: "Cover Art Mode (Off/Memory/Local, icon source)",
  coverArtMaxWidth: "Cover Art Max Width (64/128/256/512, smaller=less lag)",
  coverArtMaxBase64Length: "Cover Art Max Base64 Length (0=unlimited)",
  elapsedTickMs: "Elapsed Update Interval (ms) (0=off, local ticker)",
  stateReplayMs: "State Replay Interval (ms) (0=off)",
  elapsedDurationEnabled: "Send Elapsed/Duration States (True/False, local UI)",
  minimalStateMode: "Minimal State Mode (True/False, fewer states)",
  extendedStatesEnabled: "Extended States Enabled (True/False, volume/like/repeat/cover)"
};
const LEGACY_SETTINGS_LABELS = {
  hostname: ["Companion Server Hostname (Advanced)"],
  port: ["Companion Server Port"],
  authToken: ["Companion Token"],
  pollIntervalMs: ["Poll Interval (ms) (Advanced)"],
  coverDownloadEnabled: ["Cover Art Mode (Off/Memory/Local)"],
  coverArtMaxWidth: ["Cover Art Max Width (64/128/256/512)"],
  coverArtMaxBase64Length: ["Cover Art Max Base64 Length (0=unlimited)"],
  elapsedTickMs: ["Elapsed Update Interval (ms) (0=off)"],
  elapsedDurationEnabled: ["Send Elapsed/Duration States (True/False)"],
  minimalStateMode: ["Minimal State Mode (True/False)"],
  extendedStatesEnabled: ["Extended States Enabled (True/False)"]
};
const LEGACY_COVER_SETTING_LABELS = [
  "Download Cover Art (Local File/Base64) (True/False)",
  "Download Cover Art (Local File/Base64)",
  "Cover Art Mode (Off/Memory/Local)"
];
const COVER_ART_MODES = {
  off: "off",
  memory: "memory",
  local: "local"
};
const SETTINGS_STATUS_LABEL = "Connection Status (Read-Only)";
const SETTINGS_TOKEN_STATUS_LABEL = "Token Status (Read-Only)";

const CONNECTORS = {
  volume: "com.hellblazer90.ytmdesktop.v2.connector.volume"
};

const STATES = {
  title: "ytmd.title",
  artist: "ytmd.artist",
  album: "ytmd.album",
  coverUrl: "ytmd.coverUrl",
  coverUrlSmall: "ytmd.coverUrlSmall",
  coverPath: "ytmd.coverPath",
  coverFileUrl: "ytmd.coverFileUrl",
  coverDebug: "ytmd.coverDebug",
  coverBase64: "ytmd.coverBase64",
  coverBase64SendCount: "ytmd.coverBase64SendCount",
  hasSong: "ytmd.hasSong",
  isPaused: "ytmd.isPaused",
  isPlaying: "ytmd.isPlaying",
  trackState: "ytmd.trackState",
  durationSec: "ytmd.durationSec",
  durationText: "ytmd.durationText",
  elapsedSec: "ytmd.elapsedSec",
  elapsedText: "ytmd.elapsedText",
  volumePercent: "ytmd.volumePercent",
  isMuted: "ytmd.isMuted",
  adPlaying: "ytmd.adPlaying",
  likeState: "ytmd.likeState",
  repeatMode: "ytmd.repeatMode",
  url: "ytmd.url",
  videoId: "ytmd.videoId",
  playlistId: "ytmd.playlistId",
  mediaType: "ytmd.mediaType",
  isLive: "ytmd.isLive",
  connectionStatus: "ytmd.connectionStatus"
};

const EVENTS = {
  isPaused: "ytmd.event.isPaused",
  likeState: "ytmd.event.likeState",
  repeatMode: "ytmd.event.repeatMode"
};

const defaults = {
  hostname: "127.0.0.1",
  port: 9863,
  authToken: "",
  pollIntervalMs: 6000,
  coverArtMode: COVER_ART_MODES.memory,
  coverArtMaxWidth: COVER_ART_DEFAULT_MAX_WIDTH,
  coverArtMaxBase64Length: COVER_ART_DEFAULT_MAX_BASE64_LENGTH,
  elapsedTickMs: DEFAULT_ELAPSED_TICK_MS,
  stateReplayMs: DEFAULT_STATE_REPLAY_MS,
  elapsedDurationEnabled: true,
  minimalStateMode: false,
  extendedStatesEnabled: true
};

const ytmApi = new YtmDesktopApi(defaults);
let currentConfig = Object.assign({}, defaults);

let pollTimer = null;
let reconnectTimer = null;
let pollInFlight = false;
let connecting = false;
let connectionStatus = "";
let isConnected = false;
const lastSettingValues = new Map();
let lastSettingsSignature = "";
let lastSettingsLogAt = 0;
let lastStatusSettingRefreshAt = 0;
const settingAliases = new Map();
const lastStateValues = new Map();
let tokenStatusOverride = "";
let tokenWatchTimer = null;
const lastActionTimes = new Map();
const lastEventValues = new Map();

let lastVolume = null;
let lastMuted = null;
let lastProgress = null;
let lastDuration = null;
let lastLikeState = "";
let lastRepeatMode = "";
let lastTrackState = "";
let lastStateRequestAt = 0;
let rateLimitUntil = 0;
let lastCommandAt = 0;
let commandBackoffUntil = 0;
let commandQueue = Promise.resolve();
let lastStateSnapshot = null;
let stateReplayTimer = null;
let elapsedTimer = null;
let elapsedTickMs = defaults.elapsedTickMs;
let stateReplayMs = defaults.stateReplayMs;
let elapsedDurationEnabled = defaults.elapsedDurationEnabled;
let minimalStateMode = defaults.minimalStateMode;
let extendedStatesEnabled = defaults.extendedStatesEnabled;
let lastElapsedBaseSec = null;
let lastElapsedAt = 0;
let pendingVolume = null;
let volumeTimer = null;
let volumeInFlight = false;
let lastConnectorVolumeSent = null;
let coverArtUrl = "";
let coverArtReadyUrl = "";
let coverArtReadyPath = "";
let coverArtSlot = 0;
let pendingCoverUrl = "";
let coverArtInFlight = false;
let lastCoverDebug = "";
let lastCoverBase64 = "";
let lastCoverVideoId = "";
let lastCoverFetchFailed = false;
let coverArtMode = defaults.coverArtMode;
let coverArtMaxWidth = defaults.coverArtMaxWidth;
let coverArtMaxBase64Length = defaults.coverArtMaxBase64Length;
let lastCoverBase64SentAt = 0;
let pendingCoverBase64 = "";
let pendingCoverBase64Timer = null;
let coverBase64SendCount = 0;

const tpClient = new TouchPortalClient({
  pluginId: PLUGIN_ID,
  autoReconnect: true
});

function log(message) {
  console.log(`[${LOG_PREFIX}] ${message}`);
}

let instanceLockPath = "";

function getCoverArtPath(slot = 0) {
  const filename = slot === 1 ? COVER_ART_ALT_FILENAME : COVER_ART_FILENAME;
  return path.join(__dirname, "..", filename);
}

function getLockFilePath() {
  return path.join(__dirname, "..", "ytmd_companion.lock");
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireInstanceLock() {
  const lockPath = getLockFilePath();
  const pidText = String(process.pid);
  try {
    fs.writeFileSync(lockPath, pidText, { flag: "wx" });
    instanceLockPath = lockPath;
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") {
      log(`Failed to create lock file: ${err.message}`);
      instanceLockPath = lockPath;
      return true;
    }
  }

  let existingPid = null;
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      existingPid = parsed;
    }
  } catch (err) {
    log(`Failed to read lock file: ${err.message}`);
  }

  if (existingPid && isProcessAlive(existingPid)) {
    log(`Another instance is running (pid ${existingPid}).`);
    return false;
  }

  try {
    fs.writeFileSync(lockPath, pidText, "utf8");
    instanceLockPath = lockPath;
    return true;
  } catch (err) {
    log(`Failed to update lock file: ${err.message}`);
    return true;
  }
}

function releaseInstanceLock() {
  if (!instanceLockPath) {
    return;
  }
  try {
    fs.unlinkSync(instanceLockPath);
  } catch {}
}

if (!acquireInstanceLock()) {
  process.exit(0);
}

process.on("exit", releaseInstanceLock);
process.on("SIGINT", () => {
  releaseInstanceLock();
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseInstanceLock();
  process.exit(0);
});

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function parseNonNegativeNumber(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function parseBooleanSetting(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseCoverArtMode(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value ? COVER_ART_MODES.local : COVER_ART_MODES.off;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["off", "false", "0", "no", "n", "disabled", "disable"].includes(normalized)) {
    return COVER_ART_MODES.off;
  }
  if (["memory", "mem", "ram", "base64", "b64", "inline"].includes(normalized)) {
    return COVER_ART_MODES.memory;
  }
  if (["local", "file", "disk", "true", "1", "yes", "y", "on", "download"].includes(normalized)) {
    return COVER_ART_MODES.local;
  }
  return fallback;
}

function parseCoverArtMaxWidth(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (COVER_ART_ALLOWED_WIDTHS.includes(num)) {
    return num;
  }
  return fallback;
}

function parseCoverArtMaxBase64Length(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num <= 0) {
    return 0;
  }
  return Math.floor(num);
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeChoice(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStateValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  return String(value);
}

function toFileUrl(filePath) {
  if (!filePath) {
    return "";
  }
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return "";
  }
}

function describeCoverFile(filePath) {
  if (!filePath) {
    return "";
  }
  const name = path.basename(filePath);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return `${name} (not a file)`;
    }
    return `${name} (${stat.size} bytes)`;
  } catch {
    return `${name} (missing)`;
  }
}

function buildCoverBase64(filePath) {
  if (!filePath) {
    return "";
  }
  try {
    const buffer = fs.readFileSync(filePath);
    if (!buffer || buffer.length === 0) {
      return "";
    }
    return buffer.toString("base64");
  } catch {
    return "";
  }
}

function truncateCoverUrl(url) {
  if (!url) {
    return "";
  }
  const text = String(url);
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 117)}...`;
}

function setCoverDebug(message) {
  const textValue = message ? String(message) : "";
  if (textValue === lastCoverDebug) {
    return;
  }
  lastCoverDebug = textValue;
  updateState(STATES.coverDebug, textValue);
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.coverDebug] = textValue;
  }
}

function clearPendingCoverBase64() {
  if (pendingCoverBase64Timer) {
    clearTimeout(pendingCoverBase64Timer);
    pendingCoverBase64Timer = null;
  }
  pendingCoverBase64 = "";
}

function incrementCoverBase64SendCount() {
  coverBase64SendCount += 1;
  updateState(STATES.coverBase64SendCount, String(coverBase64SendCount));
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.coverBase64SendCount] = String(coverBase64SendCount);
  }
}

function updateCoverBase64State(value) {
  const textValue = value || "";
  if (coverArtMaxBase64Length > 0 && textValue.length > coverArtMaxBase64Length) {
    clearPendingCoverBase64();
    lastCoverBase64 = "";
    if (lastStateSnapshot) {
      lastStateSnapshot[STATES.coverBase64] = "";
    }
    updateState(STATES.coverBase64, "");
    lastCoverBase64SentAt = 0;
    setCoverDebug(`base64 too large (${textValue.length} > ${coverArtMaxBase64Length})`);
    return false;
  }
  if (textValue === lastCoverBase64 && !pendingCoverBase64Timer) {
    return true;
  }
  lastCoverBase64 = textValue;
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.coverBase64] = textValue;
  }

  if (!textValue) {
    clearPendingCoverBase64();
    updateState(STATES.coverBase64, "");
    lastCoverBase64SentAt = 0;
    return true;
  }

  const now = Date.now();
  const elapsed = now - lastCoverBase64SentAt;
  if (elapsed >= COVER_ART_BASE64_MIN_INTERVAL_MS && !pendingCoverBase64Timer) {
    updateState(STATES.coverBase64, textValue);
    incrementCoverBase64SendCount();
    lastCoverBase64SentAt = now;
    return true;
  }

  pendingCoverBase64 = textValue;
  if (!pendingCoverBase64Timer) {
    const delay = Math.max(0, COVER_ART_BASE64_MIN_INTERVAL_MS - elapsed);
    pendingCoverBase64Timer = setTimeout(() => {
      pendingCoverBase64Timer = null;
      if (!pendingCoverBase64) {
        return;
      }
      updateState(STATES.coverBase64, pendingCoverBase64);
      incrementCoverBase64SendCount();
      lastCoverBase64SentAt = Date.now();
      pendingCoverBase64 = "";
    }, delay);
  }
  return true;
}

function updateCoverPathState(value) {
  const textValue = value || "";
  updateState(STATES.coverPath, textValue);
  updateState(STATES.coverFileUrl, toFileUrl(textValue));
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.coverPath] = textValue;
    lastStateSnapshot[STATES.coverFileUrl] = toFileUrl(textValue);
  }
}

function clearNonMinimalStates() {
  const ids = [
    STATES.coverUrl,
    STATES.coverUrlSmall,
    STATES.coverPath,
    STATES.coverFileUrl,
    STATES.coverBase64,
    STATES.coverBase64SendCount,
    STATES.durationSec,
    STATES.durationText,
    STATES.elapsedSec,
    STATES.elapsedText,
    STATES.volumePercent,
    STATES.isMuted,
    STATES.adPlaying,
    STATES.isLive,
    STATES.likeState,
    STATES.repeatMode,
    STATES.url,
    STATES.videoId,
    STATES.playlistId,
    STATES.mediaType
  ];

  for (const id of ids) {
    updateState(id, "");
    if (lastStateSnapshot) {
      lastStateSnapshot[id] = "";
    }
  }
}

function clearExtendedStates() {
  const ids = [
    STATES.volumePercent,
    STATES.isMuted,
    STATES.adPlaying,
    STATES.isLive,
    STATES.likeState,
    STATES.repeatMode,
    STATES.url,
    STATES.videoId,
    STATES.playlistId,
    STATES.mediaType
  ];

  for (const id of ids) {
    updateState(id, "");
    if (lastStateSnapshot) {
      lastStateSnapshot[id] = "";
    }
  }
}

function applyCoverArtMode(mode) {
  pendingCoverUrl = "";
  coverArtUrl = "";
  coverArtReadyUrl = "";
  coverArtReadyPath = "";
  lastCoverVideoId = "";
  lastCoverFetchFailed = false;
  clearPendingCoverBase64();
  coverBase64SendCount = 0;
  updateCoverPathState("");
  updateCoverBase64State("");
  updateState(STATES.coverBase64SendCount, "");

  if (mode === COVER_ART_MODES.memory) {
    setCoverDebug("cover art mode: memory");
    return;
  }
  if (mode === COVER_ART_MODES.local) {
    setCoverDebug("cover art mode: local");
    return;
  }
  setCoverDebug("cover art mode: off");
}

async function downloadCoverArt(url) {
  if (minimalStateMode) {
    return;
  }
  if (coverArtMode === COVER_ART_MODES.off) {
    setCoverDebug("cover art mode: off");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COVER_ART_TIMEOUT_MS);

  try {
    setCoverDebug(`downloading: ${truncateCoverUrl(url)}`);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const mode = coverArtMode;
    if (minimalStateMode) {
      return;
    }
    if (mode === COVER_ART_MODES.off) {
      setCoverDebug("cover art mode: off");
      return;
    }
    if (pendingCoverUrl && pendingCoverUrl !== url) {
      setCoverDebug("download superseded");
      return;
    }

    const base64Length = buffer && buffer.length ? Math.ceil(buffer.length / 3) * 4 : 0;
    const contentType = res.headers.get("content-type") || "";
    const typeInfo = contentType ? ` type=${contentType}` : "";
    const base64Info = base64Length ? ` base64=${base64Length}` : " base64=0";
    const base64TooLarge =
      coverArtMaxBase64Length > 0 && base64Length > coverArtMaxBase64Length;

    if (mode === COVER_ART_MODES.memory) {
      coverArtReadyUrl = url;
      coverArtReadyPath = "";
      updateCoverPathState("");
      if (base64TooLarge) {
        updateCoverBase64State("");
        lastCoverFetchFailed = false;
        setCoverDebug(
          `base64 too large (${base64Length} > ${coverArtMaxBase64Length})${typeInfo}`
        );
        return;
      }
      const base64Value = buffer && buffer.length ? buffer.toString("base64") : "";
      updateCoverBase64State(base64Value);
      lastCoverFetchFailed = false;
      setCoverDebug(`ready: memory${typeInfo}${base64Info}`);
      return;
    }

    const outputPath = getCoverArtPath(coverArtSlot);
    fs.writeFileSync(outputPath, buffer);
    coverArtReadyUrl = url;
    coverArtReadyPath = outputPath;
    coverArtSlot = coverArtSlot === 0 ? 1 : 0;
    updateCoverPathState(outputPath);
    if (base64TooLarge) {
      updateCoverBase64State("");
      lastCoverFetchFailed = false;
      setCoverDebug(
        `ready: ${describeCoverFile(outputPath)}${typeInfo} base64 too large (${base64Length} > ${coverArtMaxBase64Length})`
      );
      return;
    }
    const base64Value = buffer && buffer.length ? buffer.toString("base64") : "";
    updateCoverBase64State(base64Value);
    lastCoverFetchFailed = false;
    setCoverDebug(`ready: ${describeCoverFile(outputPath)}${typeInfo}${base64Info}`);
  } catch (err) {
    log(`Cover art download failed: ${err.message}`);
    coverArtReadyUrl = "";
    coverArtReadyPath = "";
    updateCoverPathState("");
    updateCoverBase64State("");
    lastCoverFetchFailed = true;
    setCoverDebug(`download failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function flushCoverArtQueue() {
  if (coverArtInFlight) {
    return;
  }

  if (!pendingCoverUrl) {
    return;
  }

  const nextUrl = pendingCoverUrl;
  pendingCoverUrl = "";
  coverArtInFlight = true;
  coverArtUrl = nextUrl;

  await downloadCoverArt(nextUrl);

  coverArtInFlight = false;
  if (pendingCoverUrl && pendingCoverUrl !== coverArtUrl) {
    flushCoverArtQueue();
  }
}

function queueCoverArt(url) {
  if (minimalStateMode) {
    return;
  }
  if (coverArtMode === COVER_ART_MODES.off) {
    return;
  }
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    coverArtUrl = "";
    coverArtReadyUrl = "";
    coverArtReadyPath = "";
    pendingCoverUrl = "";
    updateCoverPathState("");
    updateCoverBase64State("");
    setCoverDebug(trimmed ? "cover url invalid" : "cover url empty");
    return;
  }

  if (trimmed === coverArtReadyUrl) {
    if (
      coverArtMode === COVER_ART_MODES.local &&
      coverArtReadyPath &&
      fs.existsSync(coverArtReadyPath)
    ) {
      updateCoverPathState(coverArtReadyPath);
      const accepted = updateCoverBase64State(buildCoverBase64(coverArtReadyPath));
      if (accepted) {
        setCoverDebug(`ready: ${describeCoverFile(coverArtReadyPath)}`);
      }
      return;
    }
    if (coverArtMode === COVER_ART_MODES.memory && lastCoverBase64) {
      updateCoverPathState("");
      const accepted = updateCoverBase64State(lastCoverBase64);
      if (accepted) {
        setCoverDebug(`ready: memory base64=${lastCoverBase64.length}`);
      }
      return;
    }
  }

  if (trimmed !== coverArtReadyUrl) {
    coverArtReadyUrl = "";
    coverArtReadyPath = "";
    updateCoverPathState("");
    updateCoverBase64State("");
  }

  pendingCoverUrl = trimmed;
  flushCoverArtQueue();
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildActionSignature(actionId, actionData) {
  const safeId = actionId ? String(actionId) : "";
  const dataSignature = stableStringify(actionData);
  return `${safeId}|${dataSignature}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) {
    return "";
  }

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldDebounce(actionId, minIntervalMs = ACTION_DEBOUNCE_MS) {
  if (!actionId) {
    return false;
  }

  const now = Date.now();
  const last = lastActionTimes.get(actionId);
  if (last && now - last < minIntervalMs) {
    return true;
  }

  lastActionTimes.set(actionId, now);
  return false;
}

function arrayToSettings(entries) {
  const settings = {};

  if (!Array.isArray(entries)) {
    return settings;
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    let id = entry.id || entry.key || entry.name;
    let value = entry.value !== undefined ? entry.value : entry.default;

    if (!id) {
      const keys = Object.keys(entry);
      if (keys.length === 1) {
        id = keys[0];
        value = entry[id];
      }
    }

    if (id) {
      settings[id] = value;
    }
  }

  return settings;
}

function extractSettings(data) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.values && typeof data.values === "object" && !Array.isArray(data.values)) {
      return data.values;
    }
    if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
      return data.settings;
    }
    const keys = Object.keys(data);
    if (
      keys.some((key) => Object.values(SETTINGS).includes(key)) ||
      keys.some(
        (key) =>
          Object.values(SETTINGS_LABELS).includes(key) ||
          LEGACY_COVER_SETTING_LABELS.includes(key)
      )
    ) {
      return data;
    }
  }

  if (Array.isArray(data)) {
    return arrayToSettings(data);
  }

  if (data && Array.isArray(data.settings)) {
    return arrayToSettings(data.settings);
  }

  if (data && data.payload && Array.isArray(data.payload.settings)) {
    return arrayToSettings(data.payload.settings);
  }

  if (data && Array.isArray(data.values)) {
    return arrayToSettings(data.values);
  }

  return {};
}

function extractActionData(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (Array.isArray(payload.data)) {
    return arrayToSettings(payload.data);
  }

  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }

  if (Array.isArray(payload.values)) {
    return arrayToSettings(payload.values);
  }

  if (payload.values && typeof payload.values === "object") {
    return payload.values;
  }

  return {};
}

function getActionValue(values, idKey, nameKey) {
  if (!values || typeof values !== "object") {
    return undefined;
  }

  if (values[idKey] !== undefined) {
    return values[idKey];
  }
  if (values[nameKey] !== undefined) {
    return values[nameKey];
  }
  const keys = Object.keys(values);
  for (const key of keys) {
    if (key.endsWith(`.${idKey}`) || key.endsWith(`.${nameKey}`)) {
      return values[key];
    }
  }
  return undefined;
}

function getSetting(settings, idKey, nameKey) {
  if (settings[idKey] !== undefined) {
    return settings[idKey];
  }
  if (settings[nameKey] !== undefined) {
    return settings[nameKey];
  }
  return undefined;
}

function getSettingWithLegacy(settings, idKey, nameKey, legacyKeys) {
  let value = getSetting(settings, idKey, nameKey);
  if (value !== undefined) {
    return value;
  }
  if (!legacyKeys || legacyKeys.length === 0) {
    return undefined;
  }
  for (const legacyKey of legacyKeys) {
    value = getSetting(settings, idKey, legacyKey);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function getCoverArtSetting(settings) {
  let value = getSetting(settings, SETTINGS.coverDownloadEnabled, SETTINGS_LABELS.coverDownloadEnabled);
  if (value !== undefined) {
    return value;
  }
  for (const label of LEGACY_COVER_SETTING_LABELS) {
    value = getSetting(settings, SETTINGS.coverDownloadEnabled, label);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeSettingValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return String(value);
}

function buildSettingsSignature(settings) {
  const hostname = getSettingWithLegacy(
    settings,
    SETTINGS.hostname,
    SETTINGS_LABELS.hostname,
    LEGACY_SETTINGS_LABELS.hostname
  );
  const token = getSettingWithLegacy(
    settings,
    SETTINGS.authToken,
    SETTINGS_LABELS.authToken,
    LEGACY_SETTINGS_LABELS.authToken
  );
  const port = getSettingWithLegacy(
    settings,
    SETTINGS.port,
    SETTINGS_LABELS.port,
    LEGACY_SETTINGS_LABELS.port
  );
  const poll = getSettingWithLegacy(
    settings,
    SETTINGS.pollIntervalMs,
    SETTINGS_LABELS.pollIntervalMs,
    LEGACY_SETTINGS_LABELS.pollIntervalMs
  );
  const coverDownload = getCoverArtSetting(settings);
  const coverMaxWidth = getSettingWithLegacy(
    settings,
    SETTINGS.coverArtMaxWidth,
    SETTINGS_LABELS.coverArtMaxWidth,
    LEGACY_SETTINGS_LABELS.coverArtMaxWidth
  );
  const coverMaxBase64 = getSettingWithLegacy(
    settings,
    SETTINGS.coverArtMaxBase64Length,
    SETTINGS_LABELS.coverArtMaxBase64Length,
    LEGACY_SETTINGS_LABELS.coverArtMaxBase64Length
  );
  const elapsedTick = getSettingWithLegacy(
    settings,
    SETTINGS.elapsedTickMs,
    SETTINGS_LABELS.elapsedTickMs,
    LEGACY_SETTINGS_LABELS.elapsedTickMs
  );
  const stateReplay = getSetting(settings, SETTINGS.stateReplayMs, SETTINGS_LABELS.stateReplayMs);
  const elapsedEnabled = getSettingWithLegacy(
    settings,
    SETTINGS.elapsedDurationEnabled,
    SETTINGS_LABELS.elapsedDurationEnabled,
    LEGACY_SETTINGS_LABELS.elapsedDurationEnabled
  );
  const minimalMode = getSettingWithLegacy(
    settings,
    SETTINGS.minimalStateMode,
    SETTINGS_LABELS.minimalStateMode,
    LEGACY_SETTINGS_LABELS.minimalStateMode
  );
  const extendedEnabled = getSettingWithLegacy(
    settings,
    SETTINGS.extendedStatesEnabled,
    SETTINGS_LABELS.extendedStatesEnabled,
    LEGACY_SETTINGS_LABELS.extendedStatesEnabled
  );

  const hasRelevant =
    hostname !== undefined ||
    token !== undefined ||
    port !== undefined ||
    poll !== undefined ||
    coverDownload !== undefined ||
    coverMaxWidth !== undefined ||
    coverMaxBase64 !== undefined ||
    elapsedTick !== undefined ||
    stateReplay !== undefined ||
    elapsedEnabled !== undefined ||
    minimalMode !== undefined ||
    extendedEnabled !== undefined;

  if (!hasRelevant) {
    return "";
  }

  return stableStringify({
    hostname: normalizeSettingValue(hostname),
    authToken: normalizeSettingValue(token),
    port: normalizeSettingValue(port),
    pollIntervalMs: normalizeSettingValue(poll),
    coverArtMode: normalizeSettingValue(coverDownload),
    coverArtMaxWidth: normalizeSettingValue(coverMaxWidth),
    coverArtMaxBase64Length: normalizeSettingValue(coverMaxBase64),
    elapsedTickMs: normalizeSettingValue(elapsedTick),
    stateReplayMs: normalizeSettingValue(stateReplay),
    elapsedDurationEnabled: normalizeSettingValue(elapsedEnabled),
    minimalStateMode: normalizeSettingValue(minimalMode),
    extendedStatesEnabled: normalizeSettingValue(extendedEnabled)
  });
}

function registerSettingAliases(settings) {
  if (!settings || typeof settings !== "object") {
    return;
  }

  for (const key of Object.keys(settings)) {
    if (!key) {
      continue;
    }
    const normalized = String(key).trim().toLowerCase();
    if (!settingAliases.has(normalized)) {
      settingAliases.set(normalized, key);
    }
  }
}

function resolveSettingName(name) {
  if (!name) {
    return name;
  }
  const normalized = String(name).trim().toLowerCase();
  return settingAliases.get(normalized) || name;
}

function syncSettingCache(settings) {
  if (!settings || typeof settings !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(settings)) {
    if (!key) {
      continue;
    }
    const resolved = resolveSettingName(key);
    lastSettingValues.set(resolved, normalizeSettingValue(value));
  }
}

function shouldProcessSettings(settings) {
  const signature = buildSettingsSignature(settings);
  if (!signature) {
    return false;
  }

  if (signature === lastSettingsSignature) {
    return false;
  }

  lastSettingsSignature = signature;
  return true;
}

function logSettingsReceived() {
  const now = Date.now();
  if (now - lastSettingsLogAt < SETTINGS_LOG_THROTTLE_MS) {
    return;
  }
  lastSettingsLogAt = now;
  log("TouchPortal settings received.");
}

function refreshStatusSettings(settings) {
  const now = Date.now();
  if (now - lastStatusSettingRefreshAt < STATUS_SETTING_REFRESH_MS) {
    return;
  }

  const expectedConnection = connectionStatus || "";
  const expectedToken = getExpectedTokenStatus();

  const connectionNormalized = String(SETTINGS_STATUS_LABEL).trim().toLowerCase();
  const tokenNormalized = String(SETTINGS_TOKEN_STATUS_LABEL).trim().toLowerCase();
  const hasConnectionSetting = settingAliases.has(connectionNormalized);
  const hasTokenSetting = settingAliases.has(tokenNormalized);

  const connectionKey = resolveSettingName(SETTINGS_STATUS_LABEL);
  const tokenKey = resolveSettingName(SETTINGS_TOKEN_STATUS_LABEL);

  const connectionValue = settings && connectionKey ? settings[connectionKey] : undefined;
  const tokenValue = settings && tokenKey ? settings[tokenKey] : undefined;

  const connectionMatch =
    hasConnectionSetting &&
    connectionValue !== undefined &&
    normalizeSettingValue(connectionValue) === normalizeSettingValue(expectedConnection);
  const tokenMatch =
    hasTokenSetting &&
    tokenValue !== undefined &&
    normalizeSettingValue(tokenValue) === normalizeSettingValue(expectedToken);

  if (hasConnectionSetting && !connectionMatch) {
    updateSetting(SETTINGS_STATUS_LABEL, expectedConnection);
  }
  if (hasTokenSetting && !tokenMatch) {
    updateSetting(SETTINGS_TOKEN_STATUS_LABEL, expectedToken);
  }

  lastStatusSettingRefreshAt = now;
}

function forceStatusSettingsSync() {
  const connectionKey = resolveSettingName(SETTINGS_STATUS_LABEL);
  const tokenKey = resolveSettingName(SETTINGS_TOKEN_STATUS_LABEL);

  if (connectionKey) {
    lastSettingValues.delete(connectionKey);
  }
  if (tokenKey) {
    lastSettingValues.delete(tokenKey);
  }

  updateSetting(SETTINGS_STATUS_LABEL, connectionStatus || "");
  updateSetting(SETTINGS_TOKEN_STATUS_LABEL, getExpectedTokenStatus());
}

function applySettings(settings) {
  const hostnameRaw = getSettingWithLegacy(
    settings,
    SETTINGS.hostname,
    SETTINGS_LABELS.hostname,
    LEGACY_SETTINGS_LABELS.hostname
  );
  const tokenRaw = getSettingWithLegacy(
    settings,
    SETTINGS.authToken,
    SETTINGS_LABELS.authToken,
    LEGACY_SETTINGS_LABELS.authToken
  );
  const portRaw = getSettingWithLegacy(
    settings,
    SETTINGS.port,
    SETTINGS_LABELS.port,
    LEGACY_SETTINGS_LABELS.port
  );
  const pollRaw = getSettingWithLegacy(
    settings,
    SETTINGS.pollIntervalMs,
    SETTINGS_LABELS.pollIntervalMs,
    LEGACY_SETTINGS_LABELS.pollIntervalMs
  );
  const coverDownloadRaw = getCoverArtSetting(settings);
  const coverMaxWidthRaw = getSettingWithLegacy(
    settings,
    SETTINGS.coverArtMaxWidth,
    SETTINGS_LABELS.coverArtMaxWidth,
    LEGACY_SETTINGS_LABELS.coverArtMaxWidth
  );
  const coverMaxBase64Raw = getSettingWithLegacy(
    settings,
    SETTINGS.coverArtMaxBase64Length,
    SETTINGS_LABELS.coverArtMaxBase64Length,
    LEGACY_SETTINGS_LABELS.coverArtMaxBase64Length
  );
  const elapsedTickRaw = getSettingWithLegacy(
    settings,
    SETTINGS.elapsedTickMs,
    SETTINGS_LABELS.elapsedTickMs,
    LEGACY_SETTINGS_LABELS.elapsedTickMs
  );
  const stateReplayRaw = getSetting(settings, SETTINGS.stateReplayMs, SETTINGS_LABELS.stateReplayMs);
  const elapsedEnabledRaw = getSettingWithLegacy(
    settings,
    SETTINGS.elapsedDurationEnabled,
    SETTINGS_LABELS.elapsedDurationEnabled,
    LEGACY_SETTINGS_LABELS.elapsedDurationEnabled
  );
  const minimalModeRaw = getSettingWithLegacy(
    settings,
    SETTINGS.minimalStateMode,
    SETTINGS_LABELS.minimalStateMode,
    LEGACY_SETTINGS_LABELS.minimalStateMode
  );
  const extendedEnabledRaw = getSettingWithLegacy(
    settings,
    SETTINGS.extendedStatesEnabled,
    SETTINGS_LABELS.extendedStatesEnabled,
    LEGACY_SETTINGS_LABELS.extendedStatesEnabled
  );

  const hostnameValue = typeof hostnameRaw === "string" ? hostnameRaw.trim() : "";
  let tokenValue = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
  if (!tokenValue) {
    const fileToken = readTokenFromFile();
    if (fileToken) {
      tokenValue = fileToken;
      updateSetting(SETTINGS_LABELS.authToken, tokenValue);
    }
  }
  clearTokenStatusOverrideIfTokenChanged(tokenValue);
  setTokenStatus(tokenValue);

  let pollIntervalMs = parseNumber(pollRaw, currentConfig.pollIntervalMs);
  if (pollIntervalMs && pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    pollIntervalMs = MIN_POLL_INTERVAL_MS;
  }

  const nextCoverArtMode = parseCoverArtMode(coverDownloadRaw, coverArtMode);
  if (nextCoverArtMode !== coverArtMode) {
    coverArtMode = nextCoverArtMode;
    applyCoverArtMode(coverArtMode);
  }

  const nextCoverArtMaxWidth = parseCoverArtMaxWidth(coverMaxWidthRaw, coverArtMaxWidth);
  if (nextCoverArtMaxWidth !== coverArtMaxWidth) {
    coverArtMaxWidth = nextCoverArtMaxWidth;
    coverArtReadyUrl = "";
    coverArtReadyPath = "";
    lastCoverVideoId = "";
    lastCoverFetchFailed = true;
    clearPendingCoverBase64();
    coverBase64SendCount = 0;
    updateCoverPathState("");
    updateCoverBase64State("");
    updateState(STATES.coverBase64SendCount, "");
  }

  const nextCoverArtMaxBase64Length = parseCoverArtMaxBase64Length(
    coverMaxBase64Raw,
    coverArtMaxBase64Length
  );
  if (nextCoverArtMaxBase64Length !== coverArtMaxBase64Length) {
    coverArtMaxBase64Length = nextCoverArtMaxBase64Length;
    coverArtReadyUrl = "";
    coverArtReadyPath = "";
    lastCoverVideoId = "";
    lastCoverFetchFailed = true;
    clearPendingCoverBase64();
    coverBase64SendCount = 0;
    updateCoverPathState("");
    updateCoverBase64State("");
    updateState(STATES.coverBase64SendCount, "");
  }

  const nextElapsedTickMs = parseNonNegativeNumber(elapsedTickRaw, elapsedTickMs);
  if (nextElapsedTickMs !== elapsedTickMs) {
    elapsedTickMs = nextElapsedTickMs;
    stopElapsedTicker();
    startElapsedTicker();
  }

  const nextStateReplayMs = parseNonNegativeNumber(stateReplayRaw, stateReplayMs);
  if (nextStateReplayMs !== stateReplayMs) {
    stateReplayMs = nextStateReplayMs;
    stopStateReplay();
    startStateReplay();
  }

  const nextElapsedDurationEnabled = parseBooleanSetting(
    elapsedEnabledRaw,
    elapsedDurationEnabled
  );
  if (nextElapsedDurationEnabled !== elapsedDurationEnabled) {
    elapsedDurationEnabled = nextElapsedDurationEnabled;
    stopElapsedTicker();
    startElapsedTicker();
    if (!elapsedDurationEnabled) {
      lastElapsedBaseSec = null;
      lastElapsedAt = 0;
      lastProgress = null;
      lastDuration = null;
      updateState(STATES.durationSec, "");
      updateState(STATES.durationText, "");
      updateState(STATES.elapsedSec, "");
      updateState(STATES.elapsedText, "");
      if (lastStateSnapshot) {
        lastStateSnapshot[STATES.durationSec] = "";
        lastStateSnapshot[STATES.durationText] = "";
        lastStateSnapshot[STATES.elapsedSec] = "";
        lastStateSnapshot[STATES.elapsedText] = "";
      }
    }
  }

  const nextMinimalStateMode = parseBooleanSetting(minimalModeRaw, minimalStateMode);
  if (nextMinimalStateMode !== minimalStateMode) {
    minimalStateMode = nextMinimalStateMode;
    if (minimalStateMode) {
      pendingCoverUrl = "";
      coverArtUrl = "";
      coverArtReadyUrl = "";
      coverArtReadyPath = "";
      clearPendingCoverBase64();
      coverBase64SendCount = 0;
      lastCoverDebug = "minimal state mode";
      updateCoverPathState("");
      updateCoverBase64State("");
      updateState(STATES.coverBase64SendCount, "");
      updateState(STATES.coverDebug, lastCoverDebug);
      if (lastStateSnapshot) {
        lastStateSnapshot[STATES.coverBase64SendCount] = "";
        lastStateSnapshot[STATES.coverDebug] = lastCoverDebug;
      }
      clearNonMinimalStates();
    }
  }

  const nextExtendedStatesEnabled = parseBooleanSetting(
    extendedEnabledRaw,
    extendedStatesEnabled
  );
  if (nextExtendedStatesEnabled !== extendedStatesEnabled) {
    extendedStatesEnabled = nextExtendedStatesEnabled;
    if (!extendedStatesEnabled) {
      lastConnectorVolumeSent = null;
      clearExtendedStates();
    }
  }

  const nextConfig = {
    hostname: hostnameValue || currentConfig.hostname,
    port: parseNumber(portRaw, currentConfig.port),
    authToken: tokenValue,
    pollIntervalMs
  };

  const changed =
    nextConfig.hostname !== currentConfig.hostname ||
    Number(nextConfig.port) !== Number(currentConfig.port) ||
    nextConfig.authToken !== currentConfig.authToken ||
    Number(nextConfig.pollIntervalMs) !== Number(currentConfig.pollIntervalMs);

  if (!changed) {
    if (!tokenValue) {
      setConnectionStatus("Companion token missing.");
      startTokenWatch();
    } else {
      stopTokenWatch();
    }
    return;
  }

  currentConfig = Object.assign({}, currentConfig, nextConfig);
  ytmApi.updateConfig(currentConfig);

  const tokenState = currentConfig.authToken ? "set" : "missing";
  log(`Config updated: ${ytmApi.baseUrl} (token=${tokenState}, poll=${currentConfig.pollIntervalMs}ms)`);

  stopPolling();
  stopReconnectLoop();
  if (!currentConfig.authToken) {
    setConnectionStatus("Companion token missing.");
    startTokenWatch();
    return;
  }

  stopTokenWatch();
  lastStateRequestAt = 0;
  setConnectionStatus("Disconnected");
  checkConnection();
}

function updateState(id, value) {
  const textValue = normalizeStateValue(value);
  if (lastStateValues.get(id) === textValue) {
    return;
  }
  lastStateValues.set(id, textValue);

  if (typeof tpClient.stateUpdate === "function") {
    tpClient.stateUpdate(id, textValue);
    return;
  }

  if (typeof tpClient.setState === "function") {
    tpClient.setState(id, textValue);
    return;
  }

  if (typeof tpClient.send === "function") {
    tpClient.send({ type: "stateUpdate", id, value: textValue });
  }
}

function updateSetting(name, value) {
  if (!name) {
    return;
  }

  const resolvedName = resolveSettingName(name);
  const textValue = value === null || value === undefined ? "" : String(value);
  if (lastSettingValues.get(resolvedName) === textValue) {
    return;
  }
  lastSettingValues.set(resolvedName, textValue);

  if (typeof tpClient.settingUpdate === "function") {
    tpClient.settingUpdate(resolvedName, textValue);
    return;
  }

  if (typeof tpClient.send === "function") {
    tpClient.send({ type: "settingUpdate", name: resolvedName, value: textValue });
  }
}

function setTokenStatus(tokenValue) {
  const status = tokenStatusOverride || (tokenValue ? "Saved" : "Missing");
  updateSetting(SETTINGS_TOKEN_STATUS_LABEL, status);
}

function getExpectedTokenStatus() {
  return tokenStatusOverride || (currentConfig.authToken ? "Saved" : "Missing");
}

function clearTokenStatusOverrideIfTokenChanged(nextToken) {
  if (!tokenStatusOverride) {
    return;
  }
  const normalized = typeof nextToken === "string" ? nextToken.trim() : "";
  if (!normalized || normalized !== currentConfig.authToken) {
    tokenStatusOverride = "";
  }
}

function markTokenInvalid(err) {
  if (!currentConfig.authToken) {
    tokenStatusOverride = "";
    setTokenStatus("");
    return;
  }
  const status = err && err.status ? `Invalid (${err.status})` : "Invalid";
  tokenStatusOverride = status;
  updateSetting(SETTINGS_TOKEN_STATUS_LABEL, status);
}

function getTokenFilePath() {
  return path.join(__dirname, "..", "ytmd_companion_token.txt");
}

function readTokenFromFile() {
  const tokenPath = getTokenFilePath();
  try {
    if (!fs.existsSync(tokenPath)) {
      return "";
    }
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch (err) {
    log(`Failed to read token file: ${err.message}`);
    return "";
  }
}

function hasAuthToken() {
  return Boolean(ytmApi.getToken());
}

function startTokenWatch() {
  if (tokenWatchTimer) {
    return;
  }

  tokenWatchTimer = setInterval(() => {
    const token = readTokenFromFile();
    if (!token || token === currentConfig.authToken) {
      return;
    }

    applySettings({
      [SETTINGS.authToken]: token,
      [SETTINGS_LABELS.authToken]: token
    });
  }, TOKEN_WATCH_INTERVAL_MS);
}

function stopTokenWatch() {
  if (tokenWatchTimer) {
    clearInterval(tokenWatchTimer);
    tokenWatchTimer = null;
  }
}

function saveTokenToFile(token) {
  if (!token) {
    return;
  }

  const outputPath = getTokenFilePath();
  try {
    fs.writeFileSync(outputPath, token, "utf8");
    log(`Token saved to ${outputPath}`);
  } catch (err) {
    log(`Failed to save token: ${err.message}`);
  }
}

async function generateCompanionToken() {
  const token = await ytmApi.requestToken({
    appId: "ytm_companion",
    appName: "YTM TouchPortal V2 (by HellBlazer90)",
    appVersion: "5.0.0"
  });

  updateSetting(SETTINGS_LABELS.authToken, token);
  applySettings({
    [SETTINGS.authToken]: token,
    [SETTINGS_LABELS.authToken]: token
  });
  saveTokenToFile(token);
  stopTokenWatch();
}

function buildConnectorId(connectorId) {
  if (!connectorId) {
    return "";
  }
  return `${CONNECTOR_PREFIX}_${PLUGIN_ID}_${connectorId}`;
}

function updateVolumeConnector(value) {
  if (!Number.isFinite(value)) {
    return;
  }
  const rounded = clampNumber(Math.round(value), 0, 100);
  if (lastConnectorVolumeSent === rounded) {
    return;
  }
  lastConnectorVolumeSent = rounded;

  if (typeof tpClient.connectorUpdate === "function") {
    tpClient.connectorUpdate(CONNECTORS.volume, rounded);
    return;
  }

  if (typeof tpClient.send === "function") {
    tpClient.send({
      type: "connectorUpdate",
      connectorId: buildConnectorId(CONNECTORS.volume),
      value: rounded
    });
  }
}

function scheduleVolumeSend(value) {
  if (!Number.isFinite(value)) {
    return;
  }

  const safe = clampNumber(Math.round(value), 0, 100);
  pendingVolume = safe;
  setVolumePercentLocal(safe);

  if (volumeTimer || volumeInFlight) {
    return;
  }

  volumeTimer = setTimeout(() => {
    flushVolumeSend();
  }, VOLUME_SLIDER_DEBOUNCE_MS);
}

async function flushVolumeSend() {
  if (volumeInFlight) {
    return;
  }

  if (!Number.isFinite(pendingVolume)) {
    pendingVolume = null;
    return;
  }

  const target = pendingVolume;
  pendingVolume = null;
  volumeTimer = null;
  volumeInFlight = true;

  try {
    await sendCommandLimited("setVolume", target);
    setVolumePercentLocal(target);
  } catch (err) {
    const handledAuth = err && err.kind === "auth";
    if (handledAuth) {
      handleConnectionFailure(err);
    } else {
      const status = formatConnectionStatus(err);
      setConnectionStatus(status);
    }
    const cause = err.cause && (err.cause.code || err.cause.message);
    const suffix = cause ? ` (${cause})` : "";
    log(`Connector volume failed: ${err.message}${suffix}`);

    if (!isConnected && !handledAuth) {
      startReconnectLoop();
    }
  } finally {
    volumeInFlight = false;
    if (Number.isFinite(pendingVolume)) {
      volumeTimer = setTimeout(() => {
        flushVolumeSend();
      }, VOLUME_SLIDER_DEBOUNCE_MS);
    }
  }
}

function triggerEvent(id, value) {
  const textValue = normalizeStateValue(value);

  if (typeof tpClient.triggerEvent === "function") {
    tpClient.triggerEvent(id, textValue);
    return;
  }

  if (typeof tpClient.send === "function") {
    tpClient.send({ type: "triggerEvent", id, value: textValue });
  }
}

function updateEvent(eventId, value) {
  if (!eventId) {
    return;
  }

  const textValue = normalizeStateValue(value);
  if (textValue === "") {
    return;
  }

  const lastValue = lastEventValues.get(eventId);
  if (lastValue === textValue) {
    return;
  }

  lastEventValues.set(eventId, textValue);
  triggerEvent(eventId, textValue);
}

function setConnectionStatus(status) {
  const textValue = status || "";
  if (textValue === connectionStatus) {
    return false;
  }

  connectionStatus = textValue;
  isConnected = textValue === "Connected";
  if (isConnected && tokenStatusOverride) {
    tokenStatusOverride = "";
    setTokenStatus(currentConfig.authToken);
  }
  updateState(STATES.connectionStatus, textValue);
  updateSetting(SETTINGS_STATUS_LABEL, textValue);
  return true;
}

function isConnectionError(err) {
  if (!err) {
    return false;
  }

  const code = err.code || err.errno;
  const causeCode = err.cause && (err.cause.code || err.cause.errno);
  if (code && ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "ETIMEDOUT"].includes(code)) {
    return true;
  }
  if (causeCode && ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "ETIMEDOUT"].includes(causeCode)) {
    return true;
  }

  const message = String(err.message || "").toLowerCase();
  return message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timed out") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed");
}

function formatConnectionStatus(err) {
  if (!err) {
    return "Connected";
  }

  if (err.userMessage) {
    return err.userMessage;
  }

  if (isConnectionError(err)) {
    return "Disconnected";
  }

  if (err.kind === "auth") {
    return `Auth failed: ${err.message}`;
  }

  return `Error: ${err.message}`;
}

function handleConnectionFailure(err) {
  if (err && err.kind === "auth") {
    if (!hasAuthToken() || (err.userMessage && /missing/i.test(err.userMessage))) {
      tokenStatusOverride = "";
      setTokenStatus("");
      setConnectionStatus("Companion token missing.");
      startTokenWatch();
    } else {
      markTokenInvalid(err);
      setConnectionStatus(formatConnectionStatus(err));
    }
    stopPolling();
    stopReconnectLoop();
    return;
  }
  const status = formatConnectionStatus(err);
  const changed = setConnectionStatus(status);

  if (changed) {
    log(`Connection status: ${status}`);
  }

  stopPolling();
  startReconnectLoop();
}

function enqueueCommand(task) {
  commandQueue = commandQueue.catch(() => {}).then(task);
  return commandQueue;
}

function handleCommandRateLimit(err) {
  if (!err || err.status !== 429) {
    return false;
  }
  commandBackoffUntil = Date.now() + COMMAND_BACKOFF_MS;
  return true;
}

function sendCommandLimited(command, data) {
  return enqueueCommand(async () => {
    const now = Date.now();
    if (now < commandBackoffUntil) {
      await sleep(commandBackoffUntil - now);
    }

    const sinceLast = Date.now() - lastCommandAt;
    if (sinceLast < COMMAND_MIN_INTERVAL_MS) {
      await sleep(COMMAND_MIN_INTERVAL_MS - sinceLast);
    }

    lastCommandAt = Date.now();

    try {
      return await ytmApi.sendCommand(command, data);
    } catch (err) {
      handleCommandRateLimit(err);
      throw err;
    }
  });
}

function mapLikeStatus(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (["LIKE", "DISLIKE", "INDIFFERENT", "UNKNOWN"].includes(upper)) {
      return upper;
    }
    return upper;
  }

  const num = Number(value);
  switch (num) {
    case 2:
      return "LIKE";
    case 0:
      return "DISLIKE";
    case 1:
      return "INDIFFERENT";
    default:
      return "UNKNOWN";
  }
}

function mapRepeatMode(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (["NONE", "ALL", "ONE", "UNKNOWN"].includes(upper)) {
      return upper;
    }
    return upper;
  }

  const num = Number(value);
  switch (num) {
    case 0:
      return "NONE";
    case 1:
      return "ALL";
    case 2:
      return "ONE";
    default:
      return "UNKNOWN";
  }
}

function mapTrackState(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (["PAUSED", "PLAYING", "BUFFERING", "UNKNOWN"].includes(upper)) {
      return upper;
    }
    return upper;
  }

  const num = Number(value);
  switch (num) {
    case 0:
      return "PAUSED";
    case 1:
      return "PLAYING";
    case 2:
      return "BUFFERING";
    default:
      return "UNKNOWN";
  }
}

function mapVideoType(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    return value.toUpperCase();
  }

  const num = Number(value);
  switch (num) {
    case 0:
      return "MUSIC_AUDIO";
    case 1:
      return "MUSIC_VIDEO";
    case 2:
      return "MUSIC_UPLOADED";
    case 3:
      return "PODCAST_EPISODE";
    default:
      return "UNKNOWN";
  }
}

function pickThumbnailUrl(thumbnails, maxWidth) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return "";
  }

  const hasMax = Number.isFinite(maxWidth) && maxWidth > 0;
  let best = null;
  let smallest = null;
  let largest = null;
  let fallback = null;
  for (const thumb of thumbnails) {
    if (!thumb) {
      continue;
    }
    if (!fallback) {
      fallback = thumb;
    }
    const width = Number(thumb.width);
    const safeWidth = Number.isFinite(width) ? width : 0;
    if (!largest || safeWidth >= (largest.width || 0)) {
      largest = thumb;
    }
    if (safeWidth > 0 && (!smallest || safeWidth < (smallest.width || 0))) {
      smallest = thumb;
    }
    if (hasMax && safeWidth > 0 && safeWidth <= maxWidth) {
      if (!best || safeWidth > (best.width || 0)) {
        best = thumb;
      }
    }
  }

  const chosen = hasMax ? (best || smallest || fallback) : (largest || fallback);
  return (chosen && chosen.url) || "";
}

function buildVideoUrl(videoId, playlistId) {
  if (!videoId) {
    return "";
  }

  const encodedVideo = encodeURIComponent(videoId);
  const encodedList = playlistId ? `&list=${encodeURIComponent(playlistId)}` : "";
  return `https://music.youtube.com/watch?v=${encodedVideo}${encodedList}`;
}

function updatePlayerState(state) {
  if (!state || typeof state !== "object") {
    return;
  }

  const player = state.player || {};
  const video = state.video || null;
  const queue = player.queue || null;

  const title = (video && video.title) || "";
  const artist = (video && video.author) || "";
  const album = (video && video.album) || "";
  const minimal = minimalStateMode;
  const sendCover = !minimal;
  const sendElapsed = !minimal && elapsedDurationEnabled;
  const sendExtended = !minimal && extendedStatesEnabled;
  const coverUrl = sendCover ? pickThumbnailUrl(video && video.thumbnails) : "";
  const coverArtSourceUrl = sendCover
    ? pickThumbnailUrl(video && video.thumbnails, coverArtMaxWidth) || coverUrl
    : "";
  const coverPath =
    sendCover &&
    coverArtMode === COVER_ART_MODES.local &&
    coverArtSourceUrl &&
    coverArtSourceUrl === coverArtReadyUrl &&
    coverArtReadyPath &&
    fs.existsSync(coverArtReadyPath)
      ? coverArtReadyPath
      : "";
  const coverFileUrl = coverPath ? toFileUrl(coverPath) : "";
  const coverBase64 = sendCover
    ? coverArtMode === COVER_ART_MODES.memory
      ? coverArtSourceUrl && coverArtSourceUrl === coverArtReadyUrl
        ? lastCoverBase64
        : ""
      : coverPath && coverArtReadyPath === coverPath
        ? lastCoverBase64
        : ""
    : "";
  const rawVideoId = (video && video.id) || "";
  const rawPlaylistId = state.playlistId || "";
  const videoId = sendExtended ? rawVideoId : "";
  const playlistId = sendExtended ? rawPlaylistId : "";
  const url = sendExtended ? buildVideoUrl(rawVideoId, rawPlaylistId) : "";
  const mediaType = sendExtended ? mapVideoType(video && video.videoType) : "";

  const durationSec = sendElapsed && Number.isFinite(video && video.durationSeconds)
    ? Number(video.durationSeconds)
    : null;
  const elapsedSec = sendElapsed && Number.isFinite(player && player.videoProgress)
    ? Number(player.videoProgress)
    : null;
  const volume = sendExtended && Number.isFinite(player && player.volume) ? Number(player.volume) : null;
  const muted = sendExtended && typeof player.muted === "boolean" ? player.muted : null;
  const adPlaying = sendExtended && typeof player.adPlaying === "boolean" ? player.adPlaying : null;
  const isLive = sendExtended && typeof (video && video.isLive) === "boolean" ? video.isLive : null;

  const trackState = mapTrackState(player.trackState);
  const isPaused = trackState === "PAUSED";
  const isPlaying = trackState === "PLAYING";
  const likeState = sendExtended ? mapLikeStatus(video && video.likeStatus) : "";
  const repeatMode = sendExtended ? mapRepeatMode(queue && queue.repeatMode) : "";

  const hasSong = Boolean(title || rawVideoId);
  const coverDebugValue = sendCover ? lastCoverDebug : lastCoverDebug;
  const coverBase64SendCountValue =
    sendCover && coverBase64SendCount ? String(coverBase64SendCount) : "";

  lastStateSnapshot = {
    [STATES.title]: title,
    [STATES.artist]: artist,
    [STATES.album]: album,
    [STATES.coverUrl]: coverUrl,
    [STATES.coverUrlSmall]: coverArtSourceUrl,
    [STATES.coverPath]: coverPath,
    [STATES.coverFileUrl]: coverFileUrl,
    [STATES.coverDebug]: coverDebugValue,
    [STATES.coverBase64]: coverBase64,
    [STATES.coverBase64SendCount]: coverBase64SendCountValue,
    [STATES.url]: url,
    [STATES.videoId]: videoId,
    [STATES.playlistId]: playlistId,
    [STATES.mediaType]: mediaType,
    [STATES.hasSong]: hasSong,
    [STATES.trackState]: trackState,
    [STATES.durationSec]: durationSec !== null ? Math.round(durationSec) : "",
    [STATES.durationText]: durationSec !== null ? formatTime(durationSec) : "",
    [STATES.elapsedSec]: elapsedSec !== null ? Math.round(elapsedSec) : "",
    [STATES.elapsedText]: elapsedSec !== null ? formatTime(elapsedSec) : "",
    [STATES.volumePercent]: volume !== null ? Math.round(volume) : "",
    [STATES.isMuted]: muted,
    [STATES.adPlaying]: adPlaying,
    [STATES.isLive]: isLive,
    [STATES.likeState]: likeState,
    [STATES.repeatMode]: repeatMode
  };

  updateState(STATES.title, title);
  updateState(STATES.artist, artist);
  updateState(STATES.album, album);
  updateState(STATES.coverUrl, coverUrl);
  updateState(STATES.coverUrlSmall, coverArtSourceUrl);
  updateState(STATES.coverPath, coverPath);
  updateState(STATES.coverFileUrl, coverFileUrl);
  updateCoverBase64State(coverBase64);
  updateState(STATES.coverBase64SendCount, coverBase64SendCountValue);
  updateState(STATES.url, url);
  updateState(STATES.videoId, videoId);
  updateState(STATES.playlistId, playlistId);
  updateState(STATES.mediaType, mediaType);
  updateState(STATES.hasSong, hasSong);
  updateState(STATES.trackState, trackState);

  if (trackState) {
    updateState(STATES.isPaused, isPaused);
    updateEvent(EVENTS.isPaused, isPaused);
    updateState(STATES.isPlaying, isPlaying);
  }

  if (durationSec !== null) {
    updateState(STATES.durationSec, Math.round(durationSec));
    updateState(STATES.durationText, formatTime(durationSec));
  }

  if (elapsedSec !== null) {
    updateState(STATES.elapsedSec, Math.round(elapsedSec));
    updateState(STATES.elapsedText, formatTime(elapsedSec));
    lastElapsedBaseSec = elapsedSec;
    lastElapsedAt = Date.now();
  }

  if (volume !== null) {
    setVolumePercentLocal(volume);
  }

  if (muted !== null) {
    updateState(STATES.isMuted, muted);
  }

  if (adPlaying !== null) {
    updateState(STATES.adPlaying, adPlaying);
  }

  if (isLive !== null) {
    updateState(STATES.isLive, isLive);
  }

  if (likeState) {
    updateState(STATES.likeState, likeState);
    updateEvent(EVENTS.likeState, likeState);
  }

  if (repeatMode) {
    updateState(STATES.repeatMode, repeatMode);
    updateEvent(EVENTS.repeatMode, repeatMode);
  }

  lastVolume = volume;
  lastMuted = muted;
  lastProgress = elapsedSec;
  lastDuration = durationSec;
  lastLikeState = likeState;
  lastRepeatMode = repeatMode;
  lastTrackState = trackState;

  if (
    sendCover &&
    coverArtMode !== COVER_ART_MODES.off &&
    rawVideoId &&
    (rawVideoId !== lastCoverVideoId || lastCoverFetchFailed)
  ) {
    lastCoverVideoId = rawVideoId;
    lastCoverFetchFailed = false;
    queueCoverArt(coverArtSourceUrl);
  }
}

function resendCachedStates() {
  if (!lastStateSnapshot) {
    return;
  }

  for (const [stateId, value] of Object.entries(lastStateSnapshot)) {
    updateState(stateId, value);
  }

  updateState(STATES.connectionStatus, connectionStatus);
}

function tickElapsed() {
  if (!elapsedDurationEnabled || minimalStateMode) {
    return;
  }
  if (String(lastTrackState || "").toUpperCase() !== "PLAYING") {
    return;
  }
  if (!Number.isFinite(lastElapsedBaseSec)) {
    return;
  }

  const now = Date.now();
  const delta = (now - lastElapsedAt) / 1000;
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }

  const nextRaw = lastElapsedBaseSec + delta;
  let next = Math.floor(nextRaw);
  if (Number.isFinite(lastDuration)) {
    next = Math.min(Math.floor(lastDuration), next);
  }

  if (Number.isFinite(lastProgress) && next === Math.floor(lastProgress)) {
    return;
  }

  lastProgress = next;
  lastElapsedBaseSec = nextRaw;
  lastElapsedAt = now;
  updateState(STATES.elapsedSec, next);
  updateState(STATES.elapsedText, formatTime(next));

  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.elapsedSec] = next;
    lastStateSnapshot[STATES.elapsedText] = formatTime(next);
  }
}

function startStateReplay() {
  if (stateReplayTimer || stateReplayMs <= 0) {
    return;
  }
  stateReplayTimer = setInterval(() => {
    resendCachedStates();
  }, stateReplayMs);
}

function stopStateReplay() {
  if (stateReplayTimer) {
    clearInterval(stateReplayTimer);
    stateReplayTimer = null;
  }
}

function startElapsedTicker() {
  if (elapsedTimer || elapsedTickMs <= 0 || !elapsedDurationEnabled || minimalStateMode) {
    return;
  }
  elapsedTimer = setInterval(() => {
    tickElapsed();
  }, elapsedTickMs);
}

function stopElapsedTicker() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function applyTrackState(nextState) {
  const state = String(nextState || "").toUpperCase();
  if (!state) {
    return;
  }

  lastTrackState = state;
  updateState(STATES.trackState, state);
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.trackState] = state;
  }

  if (state === "PAUSED" || state === "PLAYING") {
    const isPaused = state === "PAUSED";
    updateState(STATES.isPaused, isPaused);
    updateEvent(EVENTS.isPaused, isPaused);
    updateState(STATES.isPlaying, !isPaused);
    if (lastStateSnapshot) {
      lastStateSnapshot[STATES.isPaused] = isPaused;
      lastStateSnapshot[STATES.isPlaying] = !isPaused;
    }
    if (state === "PLAYING" && Number.isFinite(lastProgress)) {
      lastElapsedBaseSec = lastProgress;
      lastElapsedAt = Date.now();
    }
  }
}

function applyMutedState(nextMuted) {
  if (minimalStateMode || !extendedStatesEnabled) {
    return;
  }
  if (typeof nextMuted !== "boolean") {
    return;
  }

  lastMuted = nextMuted;
  updateState(STATES.isMuted, nextMuted);
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.isMuted] = nextMuted;
  }
}

function applyRepeatModeLocal(value) {
  if (minimalStateMode || !extendedStatesEnabled) {
    return;
  }
  const mode = mapRepeatMode(value);
  if (!mode) {
    return;
  }

  lastRepeatMode = mode;
  updateState(STATES.repeatMode, mode);
  updateEvent(EVENTS.repeatMode, mode);
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.repeatMode] = mode;
  }
}

function setVolumePercentLocal(value) {
  if (minimalStateMode || !extendedStatesEnabled) {
    return;
  }
  if (!Number.isFinite(value)) {
    return;
  }

  const rounded = clampNumber(Math.round(value), 0, 100);
  lastVolume = rounded;
  updateState(STATES.volumePercent, rounded);
  updateVolumeConnector(rounded);

  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.volumePercent] = rounded;
  }
}

function applySeekLocal(targetSeconds) {
  if (minimalStateMode || !elapsedDurationEnabled) {
    return;
  }
  if (!Number.isFinite(targetSeconds)) {
    return;
  }

  const safe = Math.max(0, Math.floor(targetSeconds));
  lastProgress = safe;
  lastElapsedBaseSec = safe;
  lastElapsedAt = Date.now();
  updateState(STATES.elapsedSec, safe);
  updateState(STATES.elapsedText, formatTime(safe));
  if (lastStateSnapshot) {
    lastStateSnapshot[STATES.elapsedSec] = safe;
    lastStateSnapshot[STATES.elapsedText] = formatTime(safe);
  }
}

async function changeVolume(direction, step) {
  const current = Number.isFinite(lastVolume) ? lastVolume : null;

  if (!Number.isFinite(current)) {
    const command = direction === "down" ? "volumeDown" : "volumeUp";
    await sendCommandLimited(command);
    return;
  }

  const delta = direction === "down" ? -step : step;
  const next = clampNumber(current + delta, 0, 100);
  await sendCommandLimited("setVolume", Math.round(next));
  setVolumePercentLocal(next);
}

async function seekRelative(offsetSeconds) {
  if (!Number.isFinite(lastProgress)) {
    throw new Error("Playback position unavailable.");
  }

  let target = lastProgress + offsetSeconds;
  if (Number.isFinite(lastDuration)) {
    target = Math.min(lastDuration, target);
  }
  target = Math.max(0, target);

  await sendCommandLimited("seekTo", Math.floor(target));
  applySeekLocal(target);
}

function mapRepeatModeChoice(value) {
  const mode = normalizeChoice(value);
  if (mode === "off" || mode === "none") {
    return 0;
  }
  if (mode === "one") {
    return 2;
  }
  return 1;
}

async function pollState() {
  if (pollInFlight || !currentConfig.pollIntervalMs) {
    return;
  }

  if (!hasAuthToken()) {
    setConnectionStatus("Companion token missing.");
    startTokenWatch();
    return;
  }

  if (!canRequestState()) {
    return;
  }

  pollInFlight = true;

  try {
    const state = await ytmApi.getState();
    setConnectionStatus("Connected");
    updatePlayerState(state);
  } catch (err) {
    if (!handleRateLimit(err)) {
      handleConnectionFailure(err);
    }
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  const interval = parseNumber(currentConfig.pollIntervalMs, defaults.pollIntervalMs);
  if (interval <= 0) {
    return;
  }

  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(() => {
    pollState();
  }, interval);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startReconnectLoop() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setInterval(() => {
    checkConnection();
  }, RECONNECT_INTERVAL_MS);
}

function stopReconnectLoop() {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}

async function checkConnection() {
  if (connecting) {
    return;
  }

  if (!hasAuthToken()) {
    setConnectionStatus("Companion token missing.");
    startTokenWatch();
    return;
  }

  if (!canRequestState()) {
    return;
  }

  connecting = true;

  try {
    const state = await ytmApi.getState();
    setConnectionStatus("Connected");
    updatePlayerState(state);
    startPolling();
    stopReconnectLoop();
  } catch (err) {
    if (!handleRateLimit(err)) {
      handleConnectionFailure(err);
    }
  } finally {
    connecting = false;
  }
}

async function refreshStates(force = false) {
  if (pollInFlight || connecting) {
    resendCachedStates();
    return;
  }

  if (!hasAuthToken()) {
    setConnectionStatus("Companion token missing.");
    startTokenWatch();
    resendCachedStates();
    return;
  }

  if (!force && !canRequestState()) {
    resendCachedStates();
    return;
  }

  pollInFlight = true;
  if (force) {
    lastStateRequestAt = Date.now();
  }

  try {
    const state = await ytmApi.getState();
    setConnectionStatus("Connected");
    updatePlayerState(state);
  } catch (err) {
    if (!handleRateLimit(err)) {
      handleConnectionFailure(err);
    }
  } finally {
    pollInFlight = false;
  }
}

function canRequestState() {
  const now = Date.now();
  if (now < rateLimitUntil) {
    return false;
  }
  if (now - lastStateRequestAt < MIN_STATE_INTERVAL_MS) {
    return false;
  }
  lastStateRequestAt = now;
  return true;
}

function handleRateLimit(err) {
  if (!err || err.status !== 429) {
    return false;
  }

  rateLimitUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
  const status = "Rate limited (429)";
  const changed = setConnectionStatus(status);
  if (changed) {
    log(`Connection status: ${status}`);
  }
  return true;
}

async function handleAction(data) {
  const actionId = data.actionId || data.id;
  const actionData = extractActionData(data);
  const signature = buildActionSignature(actionId, actionData);

  if (shouldDebounce(signature, ACTION_DUPLICATE_WINDOW_MS)) {
    return;
  }

  switch (actionId) {
    case "com.hellblazer90.ytmdesktop.v2.action.playback": {
      const choice = normalizeChoice(getActionValue(actionData, "choice", "Choice"));
      if (choice === "toggle" && shouldDebounce(`${actionId}:toggle`, TOGGLE_DEBOUNCE_MS)) {
        return;
      }
      if (choice === "play") {
        await sendCommandLimited("play");
        applyTrackState("PLAYING");
      } else if (choice === "pause") {
        await sendCommandLimited("pause");
        applyTrackState("PAUSED");
      } else {
        const state = String(lastTrackState || "").toUpperCase();
        if (state === "PAUSED") {
          await sendCommandLimited("play");
          applyTrackState("PLAYING");
        } else if (state === "PLAYING") {
          await sendCommandLimited("pause");
          applyTrackState("PAUSED");
        } else {
          await sendCommandLimited("playPause");
        }
      }
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.nextprev": {
      const choice = normalizeChoice(getActionValue(actionData, "direction", "Direction"));
      if (choice === "previous") {
        await sendCommandLimited("previous");
      } else {
        await sendCommandLimited("next");
      }
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.likedislike": {
      const choice = normalizeChoice(getActionValue(actionData, "choice", "Choice"));
      if (choice === "dislike") {
        if (lastLikeState !== "DISLIKE") {
          await sendCommandLimited("toggleDislike");
        }
      } else {
        if (lastLikeState !== "LIKE") {
          await sendCommandLimited("toggleLike");
        }
      }
      return;
    }
    case "ytmd.play":
      await sendCommandLimited("play");
      applyTrackState("PLAYING");
      return;
    case "ytmd.pause":
      await sendCommandLimited("pause");
      applyTrackState("PAUSED");
      return;
    case "ytmd.playpause":
      await sendCommandLimited("playPause");
      return;
    case "ytmd.next":
      await sendCommandLimited("next");
      return;
    case "ytmd.prev":
      await sendCommandLimited("previous");
      return;
    case "ytmd.toggleLike":
      await sendCommandLimited("toggleLike");
      return;
    case "ytmd.toggleDislike":
      await sendCommandLimited("toggleDislike");
      return;
    case "com.hellblazer90.ytmdesktop.v2.action.volume": {
      const direction = normalizeChoice(getActionValue(actionData, "direction", "Direction"));
      const stepRaw = getActionValue(actionData, "step", "Step");
      const step = parseOptionalNumber(stepRaw) ?? 5;
      await changeVolume(direction === "down" ? "down" : "up", step);
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.seekto":
    case "ytmd.seekTo": {
      const raw = getActionValue(actionData, "seconds", "Seconds");
      const seconds = parseOptionalNumber(raw);
      if (seconds === null) {
        throw new Error("Seek To requires seconds.");
      }
      const target = Math.floor(Math.max(0, seconds));
      await sendCommandLimited("seekTo", target);
      applySeekLocal(target);
      return;
    }
    case "ytmd.goBack": {
      const raw = getActionValue(actionData, "seconds", "Seconds");
      const seconds = parseOptionalNumber(raw) ?? 10;
      await seekRelative(-seconds);
      return;
    }
    case "ytmd.goForward": {
      const raw = getActionValue(actionData, "seconds", "Seconds");
      const seconds = parseOptionalNumber(raw) ?? 10;
      await seekRelative(seconds);
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.seek": {
      const direction = normalizeChoice(getActionValue(actionData, "direction", "Direction"));
      const raw = getActionValue(actionData, "seconds", "Seconds");
      const seconds = parseOptionalNumber(raw) ?? 10;
      if (direction === "rewind") {
        await seekRelative(-seconds);
      } else {
        await seekRelative(seconds);
      }
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.shuffle":
      if (shouldDebounce(`${actionId}:toggle`, TOGGLE_DEBOUNCE_MS)) {
        return;
      }
      await sendCommandLimited("shuffle");
      return;
    case "com.hellblazer90.ytmdesktop.v2.action.token":
      await generateCompanionToken();
      return;
    case "com.hellblazer90.ytmdesktop.v2.action.refresh":
      await refreshStates(true);
      forceStatusSettingsSync();
      return;
    case "com.hellblazer90.ytmdesktop.v2.action.repeat": {
      const mode = normalizeChoice(getActionValue(actionData, "mode", "Mode"));
      if (mode === "toggle") {
        if (shouldDebounce(`${actionId}:toggle`, TOGGLE_DEBOUNCE_MS)) {
          return;
        }
        const current = mapRepeatMode(lastRepeatMode);
        const next = current === "NONE" ? 1 : current === "ALL" ? 2 : 0;
        await sendCommandLimited("repeatMode", next);
        applyRepeatModeLocal(next);
        return;
      }
      const target = mapRepeatModeChoice(mode);
      if (lastRepeatMode && mapRepeatMode(lastRepeatMode) === mapRepeatMode(target)) {
        return;
      }
      await sendCommandLimited("repeatMode", target);
      applyRepeatModeLocal(target);
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.mute": {
      const choice = normalizeChoice(getActionValue(actionData, "choice", "Choice"));
      if (choice === "toggle" && shouldDebounce(`${actionId}:toggle`, TOGGLE_DEBOUNCE_MS)) {
        return;
      }
      if (choice === "mute") {
        await sendCommandLimited("mute");
        applyMutedState(true);
      } else if (choice === "unmute") {
        await sendCommandLimited("unmute");
        applyMutedState(false);
      } else {
        const shouldUnmute = lastMuted === true;
        const command = shouldUnmute ? "unmute" : "mute";
        await sendCommandLimited(command);
        applyMutedState(!shouldUnmute);
      }
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.setvolume":
    case "ytmd.volume": {
      const raw = getActionValue(actionData, "percent", "Percent");
      const percent = parseOptionalNumber(raw);
      if (percent === null) {
        throw new Error("Set Volume requires a percent value.");
      }
      const safePercent = clampNumber(Math.round(percent), 0, 100);
      await sendCommandLimited("setVolume", safePercent);
      setVolumePercentLocal(safePercent);
      return;
    }
    case "ytmd.mute":
      await sendCommandLimited("mute");
      applyMutedState(true);
      return;
    case "ytmd.unmute":
      await sendCommandLimited("unmute");
      applyMutedState(false);
      return;
    case "ytmd.toggleMute": {
      const shouldUnmute = lastMuted === true;
      const command = shouldUnmute ? "unmute" : "mute";
      await sendCommandLimited(command);
      applyMutedState(!shouldUnmute);
      return;
    }
    case "com.hellblazer90.ytmdesktop.v2.action.queueindex":
    case "ytmd.queuePlayIndex": {
      const raw = getActionValue(actionData, "index", "Index");
      const index = parseOptionalNumber(raw);
      if (index === null || index < 0) {
        throw new Error("Queue index must be 0 or higher.");
      }
      await sendCommandLimited("playQueueIndex", Math.floor(index));
      return;
    }
    case "ytmd.changeVideo": {
      const videoId = getActionValue(actionData, "videoId", "Video ID");
      const playlistId = getActionValue(actionData, "playlistId", "Playlist ID");
      const payload = {};

      if (videoId) {
        payload.videoId = String(videoId).trim();
      }
      if (playlistId) {
        payload.playlistId = String(playlistId).trim();
      }

      if (!payload.videoId && !payload.playlistId) {
        throw new Error("Video ID or Playlist ID is required.");
      }

      await sendCommandLimited("changeVideo", payload);
      return;
    }
    default:
      return;
  }
}

function handleSettingsPayload(data) {
  const settings = extractSettings(data);
  if (!settings || Object.keys(settings).length === 0) {
    return;
  }

  registerSettingAliases(settings);
  syncSettingCache(settings);

  if (!shouldProcessSettings(settings)) {
    return;
  }

  logSettingsReceived();
  applySettings(settings);
}

tpClient.on("connected", () => {
  log("Connected to TouchPortal");
  lastStateValues.clear();
  lastConnectorVolumeSent = null;
  setConnectionStatus("Disconnected");
  forceStatusSettingsSync();
  startStateReplay();
  startElapsedTicker();
  checkConnection();
});

tpClient.on("closePlugin", () => {
  log("TouchPortal requested shutdown.");
  stopPolling();
  stopReconnectLoop();
  stopTokenWatch();
  stopStateReplay();
  stopElapsedTicker();
  process.exit(0);
});

tpClient.on("info", (data) => {
  log("TouchPortal info received.");
  handleSettingsPayload(data);
});

tpClient.on("settings", (data) => {
  handleSettingsPayload(data);
});

tpClient.on("action", (data) => {
  const actionId = data.actionId || data.id;

  handleAction(data).catch((err) => {
    const handledAuth = err && err.kind === "auth";
    if (handledAuth) {
      handleConnectionFailure(err);
    } else {
      const status = formatConnectionStatus(err);
      setConnectionStatus(status);
    }
    const cause = err.cause && (err.cause.code || err.cause.message);
    const suffix = cause ? ` (${cause})` : "";
    log(`Action ${actionId || "unknown"} failed: ${err.message}${suffix}`);

    if (!isConnected && !handledAuth) {
      startReconnectLoop();
    }
  });
});

tpClient.on("connectorChange", (data) => {
  const connectorId = data && (data.connectorId || data.shortId || data.id);
  if (!connectorId) {
    return;
  }
  const expectedId = buildConnectorId(CONNECTORS.volume);
  const connectorText = String(connectorId);
  const matches =
    connectorId === expectedId ||
    connectorId === CONNECTORS.volume ||
    connectorText.endsWith(`_${CONNECTORS.volume}`) ||
    connectorText === CONNECTORS.volume;

  if (!matches) {
    return;
  }

  const percent = parseOptionalNumber(data.value);
  if (percent === null) {
    return;
  }

  const safePercent = clampNumber(Math.round(percent), 0, 100);
  scheduleVolumeSend(safePercent);
});

tpClient.on("close", (data) => {
  if (data && data.reason === "closePlugin") {
    return;
  }
  log("Disconnected from TouchPortal");
  lastStateValues.clear();
  lastConnectorVolumeSent = null;
  stopStateReplay();
  stopElapsedTicker();
});

tpClient.on("error", (err) => {
  log(`TouchPortal error: ${err.message}`);
});

try {
  tpClient.connect();
} catch (err) {
  log(`Failed to connect: ${err.message}`);
}

