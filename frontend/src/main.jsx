import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import "./style.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");
const TOKEN_KEY = "clipbridge_session_token";

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [accessCode, setAccessCode] = useState("");
  const [draft, setDraft] = useState("");
  const [latest, setLatest] = useState(null);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef(null);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      setToken("");
      throw new Error("Session expired. Enter your access code again.");
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || body?.detail || `Request failed (${response.status})`);
    return body;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setStatus("Locked");
      return;
    }
    let cancelled = false;
    let connection;

    async function start() {
      try {
        const clip = await request("/api/clips/latest");
        if (!cancelled && clip) setLatest(clip);

        connection = new HubConnectionBuilder()
          .withUrl(`${API}/hubs/clipboard`, {
            // Auth is bearer/Join token, not cookies — avoid credentialed CORS failures.
            withCredentials: false
          })
          .withAutomaticReconnect()
          .configureLogging(LogLevel.Error)
          .build();

        connection.on("ClipReceived", (clip) => {
          if (!cancelled) setLatest(clip);
        });
        connection.onreconnecting(() => !cancelled && setStatus("Reconnecting…"));
        connection.onreconnected(async () => {
          try {
            await connection.invoke("Join", token);
            if (!cancelled) setStatus("Live");
          } catch {
            if (!cancelled) setStatus("Reconnect failed");
          }
        });

        await connection.start();
        await connection.invoke("Join", token);
        if (!cancelled) setStatus("Live");
        connectionRef.current = connection;
      } catch (e) {
        if (!cancelled) {
          setStatus("Offline");
          setError(e.message || "Could not connect. Check the backend URL.");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      if (connection) connection.stop();
      connectionRef.current = null;
    };
  }, [token, request]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode })
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Incorrect access code." : "Could not sign in.");
      const data = await response.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setAccessCode("");
    } catch (e) {
      setError(e.message || "Could not connect to the server.");
    } finally {
      setBusy(false);
    }
  }

  async function sendClip(event) {
    event?.preventDefault();
    if (!draft.trim()) {
      setError("Paste or type some text first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const clip = await request("/api/clips", {
        method: "POST",
        body: JSON.stringify({ text: draft })
      });
      setLatest(clip);
      setStatus("Sent");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pasteFromDevice() {
    setError("");
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard reading is not available in this browser. Paste directly into the text box instead.");
      }
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error("Your device clipboard is empty.");
      setDraft(text);
    } catch (e) {
      setError(e.name === "NotAllowedError"
        ? "Clipboard permission was denied. Paste directly into the text box instead."
        : (e.message || "Could not read clipboard."));
    }
  }

  async function copyLatest() {
    if (!latest?.text) return;
    setError("");
    try {
      await navigator.clipboard.writeText(latest.text);
      setStatus("Copied to this device");
    } catch {
      setError("Browser blocked clipboard access. Select the text below and copy it manually.");
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setLatest(null);
    setStatus("Locked");
    setError("");
  }

  if (!token) {
    return (
      <main className="page narrow">
        <header className="brand">
          <div className="brand-icon">↔</div>
          <div><h1>ClipBridge</h1><p>One private clipboard for both phones.</p></div>
        </header>
        <section className="panel">
          <h2>Unlock your clipboard</h2>
          <p className="muted">Enter the private access code configured on your server.</p>
          <form onSubmit={login}>
            <label htmlFor="accessCode">Access code</label>
            <input id="accessCode" type="password" autoComplete="current-password"
              value={accessCode} onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Your private code" required />
            <button className="primary full" disabled={busy}>{busy ? "Connecting…" : "Unlock"}</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
        <p className="footnote">Personal MVP · Use HTTPS · Avoid sensitive secrets</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">↔</div>
          <div><h1>ClipBridge</h1><p>Private cross-device clipboard</p></div>
        </div>
        <div className="status-wrap">
          <span className={`status-dot ${status === "Live" || status === "Sent" || status === "Copied to this device" ? "online" : ""}`} />
          <span className="status-text">{status}</span>
          <button className="ghost small" onClick={logout}>Lock</button>
        </div>
      </header>

      <div className="grid">
        <section className="panel">
          <div className="section-heading">
            <div><h2>Send a clip</h2><p className="muted">Text, links, snippets or short codes.</p></div>
            <span className="pill">OUTGOING</span>
          </div>
          <form onSubmit={sendClip}>
            <label htmlFor="draft">Your text</label>
            <textarea id="draft" rows="7" maxLength="20000" value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste or type something to send to your other phone…" />
            <div className="meta-row"><span>{draft.length.toLocaleString()} / 20,000</span></div>
            <div className="button-row">
              <button type="button" className="secondary" onClick={pasteFromDevice}>Paste from this device</button>
              <button className="primary" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send clip ↗"}</button>
            </div>
          </form>
          <p className="hint">Tip: on mobile, you can also press and hold in the text box and choose Paste.</p>
        </section>

        <section className="panel receive-panel">
          <div className="section-heading">
            <div><h2>Latest clip</h2><p className="muted">New clips appear here in real time.</p></div>
            <span className="live-pill"><span className="status-dot online" /> LIVE</span>
          </div>
          {latest ? (
            <>
              <div className="clip-meta">
                <span>Received clip</span>
                <span>{new Date(latest.createdAt).toLocaleString()}</span>
              </div>
              <pre className="clip-content">{latest.text}</pre>
              <button className="primary full" onClick={copyLatest}>Copy latest to this device</button>
            </>
          ) : (
            <div className="empty">
              <div className="empty-icon">▤</div>
              <h3>No clips yet</h3>
              <p>Send a clip from either device and it will appear here.</p>
            </div>
          )}
          <p className="hint">Clipboard access is controlled by your browser. Keep this page open for live delivery.</p>
        </section>
      </div>

      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
      <footer className="footer"><span>Personal mode</span><span>Only send content you are comfortable storing temporarily.</span></footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
