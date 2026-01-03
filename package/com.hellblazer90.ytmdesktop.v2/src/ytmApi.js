const fetch = global.fetch ? global.fetch.bind(global) : null;
if (!fetch) {
  throw new Error("Node.js 18+ is required (fetch not available).");
}

const DEFAULTS = {
  hostname: "127.0.0.1",
  port: 9863,
  authToken: ""
};

function normalizePath(path) {
  if (!path) {
    return "";
  }

  if (path.startsWith("/")) {
    return path;
  }

  return `/${path}`;
}

function sanitizeHostname(input) {
  if (!input) {
    return "";
  }

  let host = String(input).trim();
  if (!host) {
    return "";
  }

  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");

  return host.trim();
}

class YtmDesktopApi {
  constructor(config = {}) {
    this.token = "";
    this.updateConfig(config);
  }

  updateConfig(config = {}) {
    const hostname = sanitizeHostname(config.hostname);
    const port = Number(config.port);

    this.hostname = hostname || DEFAULTS.hostname;
    this.port = Number.isFinite(port) && port > 0 ? port : DEFAULTS.port;
    this.baseUrl = `http://${this.hostname}:${this.port}`;

    if (config.authToken !== undefined) {
      this.setToken(config.authToken);
    }
  }

  setToken(token) {
    this.token = typeof token === "string" ? token.trim() : "";
  }

  getToken() {
    return this.token;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${normalizePath(path)}`;
    const method = options.method || "GET";
    const headers = Object.assign({}, options.headers || {});
    const needsAuth = options.auth !== false;
    const token = options.token !== undefined ? options.token : this.token;

    if (needsAuth) {
      if (!token) {
        const err = new Error("Companion token missing.");
        err.kind = "auth";
        err.userMessage = "Companion token missing.";
        throw err;
      }
      headers.Authorization = token;
    }

    return fetch(url, {
      method,
      headers,
      body: options.body
    });
  }

  async requestJson(path, options = {}) {
    const res = await this.request(path, options);
    const text = await res.text().catch(() => "");

    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.kind = res.status === 401 || res.status === 403 ? "auth" : "http";
      err.status = res.status;
      err.userMessage = err.kind === "auth" ? `Auth failed (${res.status})` : `Error (${res.status})`;
      err.responseText = text;
      throw err;
    }

    return data;
  }

  async requestToken(appInfo = {}) {
    const appId = appInfo.appId || "touchportal";
    const appName = appInfo.appName || "TouchPortal";
    const appVersion = appInfo.appVersion || "1.0.0";

    const codeResponse = await this.requestJson("/api/v1/auth/requestcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, appName, appVersion }),
      auth: false
    });

    const code = codeResponse && codeResponse.code;
    if (!code) {
      const err = new Error("Authorization code was not returned.");
      err.kind = "auth";
      err.userMessage = "Authorization code was not returned.";
      throw err;
    }

    const tokenResponse = await this.requestJson("/api/v1/auth/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, code }),
      auth: false
    });

    const token = tokenResponse && tokenResponse.token;
    if (!token) {
      const err = new Error("Token was not returned.");
      err.kind = "auth";
      err.userMessage = "Token was not returned.";
      throw err;
    }

    return token;
  }

  async getState() {
    return this.requestJson("/api/v1/state", { method: "GET" });
  }

  async sendCommand(command, data) {
    const payload = data === undefined ? { command } : { command, data };
    const body = JSON.stringify(payload);
    return this.requestJson("/api/v1/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
  }
}

module.exports = {
  YtmDesktopApi,
  DEFAULTS
};
