// POINT D'ENTRÉE PRINCIPAL DE L'APPLICATION FRONTEND

// Importe le routeur SPA qui va gérer la navigation et l'affichage des différentes pages.
import "./routeurSPA.js";

// === DIAGNOSTIC DROP-IN — colle ça APRÈS ton import "./routeurSPA.js" ===
(() => {
  const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ---- Patch global WebSocket pour suivre tous les WS créés par l'app
  const OriginalWS = window.WebSocket;
  const sockets = new Set<WebSocket>();
  let msgCount = 0;
  let lastServerTick: number | string | undefined;

  function extractTickFromMessage(data: any) {
    try {
      const s = typeof data === "string" ? data : (data?.toString?.() ?? "");
      // ⚠️ adapte si ton payload a un autre champ (ex: state.tick / t / frameId)
      const obj = JSON.parse(s);
      return obj?.tick ?? obj?.t ?? obj?.frameId;
    } catch { return undefined; }
  }

  (window as any).WebSocket = function(url: string, protocols?: string | string[]) {
    const ws = protocols ? new OriginalWS(url, protocols) : new OriginalWS(url);
    sockets.add(ws);
    ws.addEventListener("message", (ev) => {
      msgCount++;
      const t = extractTickFromMessage(ev.data);
      if (t !== undefined) lastServerTick = t;
    });
    ws.addEventListener("close", (ev) => {
      console.warn("[DIAG] WS closed", { code: ev.code, reason: ev.reason });
    });
    ws.addEventListener("error", (ev) => {
      console.error("[DIAG] WS error", ev);
    });
    return ws;
  } as any;
  (window as any).WebSocket.prototype = OriginalWS.prototype;

  // ---- RAF watchdog (détecte freeze de la boucle rendu/update)
  const _raf = window.requestAnimationFrame.bind(window);
  let rafCount = 0;
  let lastRafT = perfNow();
  let lastErr: unknown = null;
  function rafProbe(t: number) {
    rafCount++;
    lastRafT = t;
    try {
      // pas d’update ici: on ne fait que sonder la fluidité du main thread
    } catch (e) {
      lastErr = e;
      console.error("[DIAG] Loop exception:", e);
    } finally {
      _raf(rafProbe);
    }
  }
  _raf(rafProbe);

  // ---- Long tasks (UI bloquée > 50ms : JSON.parse lourd, layout, GC, etc.)
  let longTasks = 0;
  if ("PerformanceObserver" in window) {
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if ((e as any).duration > 50) longTasks++;
        }
      });
      // @ts-ignore
      po.observe({ type: "longtask", buffered: true });
    } catch {}
  }

  function wsStateSummary() {
    let connecting = 0, open = 0, closing = 0, closed = 0;
    for (const ws of sockets) {
      switch (ws.readyState) {
        case 0: connecting++; break;
        case 1: open++; break;
        case 2: closing++; break;
        case 3: closed++; break;
      }
    }
    return { connecting, open, closing, closed };
  }

  // ---- Heartbeat 1 Hz
  setInterval(() => {
    const sinceLastRAF = (perfNow() - lastRafT).toFixed(0);
    const states = wsStateSummary();
    console.log(
      `[DIAG] vis=${document.visibilityState} raf/s=${rafCount} wsmsg/s=${msgCount} ` +
      `lastRAFΔ=${sinceLastRAF}ms ws={open:${states.open},conn:${states.connecting},closing:${states.closing},closed:${states.closed}} ` +
      `longTasks+=${longTasks} lastErr=${lastErr ? "YES" : "no"} lastSrvTick=${lastServerTick ?? "-"}`
    );
    rafCount = 0; msgCount = 0; longTasks = 0; lastErr = null;
  }, 1000);
})();
