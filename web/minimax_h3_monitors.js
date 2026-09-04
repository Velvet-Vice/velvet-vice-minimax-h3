import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const PREFLIGHT = "VelvetViceMiniMaxH3Preflight";
const TIMER = "VelvetViceMiniMaxH3RenderTimer";
const SYSTEM_HUB = "VelvetViceMiniMaxH3SystemHub";
const DIRECTOR = "VelvetViceMiniMaxH3Director";
const H3_ENGINE = "79dd8a95-ce9d-4c14-b264-2162e8bec5ce";
const STYLE_ID = "velvet-vice-minimax-h3-monitors-v140";
const LAST_RENDER_KEY = "velvetVice.minimaxH3.timer.last.v1";

const monitors = new Set();
const timers = new Set();
let listenersInstalled = false;
let animationFrame = null;
let running = false;
let totalStarted = null;
let currentStarted = null;
let coreStarted = null;
let coreElapsed = 0;
let totalElapsed = 0;
let currentElapsed = 0;
let currentLabel = "—";
let lastElapsed = Number(localStorage.getItem(LAST_RENDER_KEY) || 0);

function typeOf(node) {
    return String(node?.comfyClass ?? node?.type ?? "");
}

function isZenNode(node) {
    const props = node?.properties ?? {};
    return typeOf(node).startsWith("VelvetViceZenMiniMaxH3")
        || props.vv_zen_h3_scope === true
        || String(props.vv_closed_system ?? "").startsWith("ZEN_H3");
}

function widget(node, name) {
    return node?.widgets?.find((item) => item?.name === name);
}

function widgetValue(node, name, fallback = null) {
    const found = widget(node, name);
    return found ? found.value : fallback;
}

function isH3Graph() {
    return (app.graph?._nodes ?? []).some((node) =>
        !isZenNode(node)
        && (typeOf(node) === SYSTEM_HUB || typeOf(node).startsWith("VelvetViceMiniMaxH3"))
    );
}

function eventNodeId(detail) {
    if (detail == null) return null;
    if (typeof detail === "string" || typeof detail === "number") return String(detail);
    return detail.node != null ? String(detail.node) : detail.node_id != null ? String(detail.node_id) : null;
}

function graphNode(rawId) {
    if (rawId == null) return null;
    return app.graph?.getNodeById?.(Number(String(rawId).split(":")[0])) ?? null;
}

function isCore(node) {
    return typeOf(node) === H3_ENGINE || node?.properties?.vv_h3_engine === true || /MINIMAX H3 ENGINE/i.test(String(node?.title ?? ""));
}

function fmt(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00:00";
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .vvh3-monitor,.vvh3-monitor *{box-sizing:border-box}
      .vvh3-monitor{--vv-a:#ae62d4;--vv-b:#3b9fd1;--vv-c:#15bc96;pointer-events:none;width:100%;height:100%;min-width:0;color:#e8eef4;font-family:Inter,"Segoe UI",Arial,sans-serif;background:linear-gradient(145deg,#101923,#16232d);border:1px solid rgba(78,150,190,.46);border-radius:12px;overflow:hidden;box-shadow:0 0 0 1px rgba(166,93,205,.13),0 0 24px rgba(51,132,180,.14),0 12px 30px rgba(0,0,0,.35);animation:vvh3-monitor-frame 7s ease-in-out infinite}
      .vvh3-monitor button,.vvh3-monitor .vvh3m-checks{pointer-events:auto}
      .vvh3m-head{padding:11px 13px;text-align:center;color:#f4f7fa;font-size:10px;font-weight:900;letter-spacing:.105em;background:linear-gradient(105deg,rgba(174,98,212,.78),rgba(59,159,209,.70),rgba(21,188,150,.65),rgba(174,98,212,.78));background-size:240% 100%;border-bottom:1px solid rgba(126,181,210,.28);animation:vvh3-monitor-flow 6.2s ease-in-out infinite}
      .vvh3m-body{height:calc(100% - 38px);min-height:0;padding:12px;overflow:auto;background:linear-gradient(160deg,rgba(18,28,38,.96),rgba(17,24,34,.98))}
      .vvh3m-status{padding:10px 11px;border:1px solid rgba(117,154,184,.23);border-radius:9px;background:#0e1720;color:#b9c8d4;font-size:9px;line-height:1.45;overflow-wrap:anywhere}
      .vvh3m-status[data-tone="ready"]{border-color:rgba(21,188,150,.30);color:#a9ddce}.vvh3m-status[data-tone="error"]{border-color:rgba(224,96,119,.42);color:#efbdc7}.vvh3m-status[data-tone="working"]{border-color:rgba(59,159,209,.42);color:#bddced}
      .vvh3m-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:9px}.vvh3m-card{min-width:0;padding:9px;border:1px solid rgba(111,150,179,.19);border-radius:9px;background:linear-gradient(145deg,#14202a,#171d2a)}
      .vvh3m-card span{display:block;color:#91a7b8;font-size:7px;font-weight:850;letter-spacing:.09em;text-transform:uppercase}.vvh3m-card strong{display:block;margin-top:4px;color:#f0f4f7;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .vvh3m-button{width:100%;margin-top:10px;padding:9px 11px;border:1px solid rgba(105,173,207,.40);border-radius:9px;color:#f7fbfd;background:linear-gradient(110deg,#70449a,#356f9f,#167d7f);background-size:180% 100%;font-size:9px;font-weight:900;letter-spacing:.08em;cursor:pointer;animation:vvh3-monitor-flow 5.3s ease-in-out infinite}.vvh3m-button:hover{filter:brightness(1.13)}.vvh3m-button:disabled{opacity:.55;cursor:wait}
      .vvh3m-checks{display:flex;flex-direction:column;gap:6px;margin-top:9px;min-height:0;overflow:auto}.vvh3m-check{display:grid;grid-template-columns:9px minmax(105px,145px) minmax(0,1fr);gap:8px;align-items:start;padding:7px 8px;border-radius:8px;background:#121c27;color:#aebdca;font-size:8px;line-height:1.4}.vvh3m-check b{color:#e5ebf0}.vvh3m-check i{width:8px;height:8px;margin-top:2px;border-radius:50%;background:#66727d}.vvh3m-check.pass i{background:#15bc96;box-shadow:0 0 9px rgba(21,188,150,.50)}.vvh3m-check.warn i{background:#d5a85e;box-shadow:0 0 8px rgba(213,168,94,.35)}.vvh3m-check.fail i{background:#df6077;box-shadow:0 0 9px rgba(223,96,119,.45)}
      @keyframes vvh3-monitor-flow{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
      @keyframes vvh3-monitor-frame{0%,100%{border-color:rgba(174,98,212,.50);box-shadow:0 0 22px rgba(174,98,212,.13),0 12px 30px rgba(0,0,0,.35)}35%{border-color:rgba(59,159,209,.54);box-shadow:0 0 24px rgba(59,159,209,.15),0 12px 30px rgba(0,0,0,.35)}68%{border-color:rgba(21,188,150,.56);box-shadow:0 0 25px rgba(21,188,150,.16),0 12px 30px rgba(0,0,0,.35)}}
      @media (prefers-reduced-motion:reduce){.vvh3-monitor,.vvh3m-head,.vvh3m-button{animation:none!important}}
    `;
    document.head.appendChild(style);
}

function addDom(node, name, shell, intrinsicHeight) {
    shell.style.width = "100%";
    shell.style.height = "100%";
    const dom = node.addDOMWidget?.(name, "VELVET VICE H3 MONITOR", shell, {
        serialize: false,
        hideOnZoom: false,
        margin: 0,
        getMinHeight: () => intrinsicHeight,
        getMaxHeight: () => Infinity,
        getHeight: () => intrinsicHeight,
    });
    if (dom) {
        dom.serialize = false;
        dom.serializeValue = () => undefined;
        dom.computeSize = (width) => [Math.max(280, Number(width) || 280), intrinsicHeight];
        dom.getHeight = () => intrinsicHeight;
        dom.computeLayoutSize = () => ({ minHeight: intrinsicHeight, maxHeight: Infinity, minWidth: 0, maxWidth: Infinity });
    }
    node.resizable = true;
    node.__vvH3MonitorShell = shell;
    monitors.add(node);
    ensureAnimation();
    return dom;
}

function systemPayload() {
    const hub = (app.graph?._nodes ?? []).find((node) => typeOf(node) === SYSTEM_HUB);
    const director = (app.graph?._nodes ?? []).find((node) => typeOf(node) === DIRECTOR);
    return {
        model_backend: String(widgetValue(hub, "model_backend", "AUTO")),
        auto_preference: String(widgetValue(hub, "auto_preference", "NATIVE")),
        native_model: String(widgetValue(hub, "native_model", "AUTO")),
        gguf_model: String(widgetValue(hub, "gguf_model", "AUTO")),
        text_encoder: String(widgetValue(hub, "text_encoder", "AUTO")),
        video_vae: String(widgetValue(hub, "video_vae", "AUTO")),
        audio_vae: String(widgetValue(hub, "audio_vae", "AUTO")),
        audio_enabled: Boolean(widgetValue(director, "native_audio_output", true)),
        fallback_if_missing: Boolean(widgetValue(hub, "fallback_if_missing", true)),
    };
}

function installPreflight(node) {
    if (typeOf(node) !== PREFLIGHT || node.__vvH3PreflightInstalled) return;
    node.__vvH3PreflightInstalled = true;
    const shell = document.createElement("div");
    shell.className = "vvh3-monitor";
    shell.innerHTML = `<div class="vvh3m-head">VELVET VICE · H3 PREFLIGHT</div><div class="vvh3m-body"><div class="vvh3m-status">READY · select your H3 files, then run the check</div><button class="vvh3m-button" type="button">RUN PREFLIGHT</button><div class="vvh3m-checks"><div class="vvh3m-check"><i></i><b>Ready</b><span>No preflight report yet.</span></div></div></div>`;
    const status = shell.querySelector(".vvh3m-status");
    const button = shell.querySelector("button");
    const checks = shell.querySelector(".vvh3m-checks");

    const run = async () => {
        button.disabled = true;
        button.textContent = "CHECKING…";
        status.dataset.tone = "working";
        status.textContent = "CHECKING · current H3 System Hub configuration";
        try {
            const response = await api.fetchApi("/velvet_vice/minimax_h3/preflight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(systemPayload()),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const report = await response.json();
            checks.replaceChildren();
            for (const item of report.checks ?? []) {
                const row = document.createElement("div");
                row.className = `vvh3m-check ${item.status ?? "fail"}`;
                const dot = document.createElement("i");
                const label = document.createElement("b");
                const message = document.createElement("span");
                label.textContent = String(item.label ?? "Check");
                message.textContent = String(item.message ?? "");
                row.append(dot, label, message);
                checks.appendChild(row);
            }
            const summary = report.summary ?? { passes: 0, warnings: 0, failures: 1 };
            status.dataset.tone = report.ok ? "ready" : "error";
            status.textContent = report.ok
                ? `READY · ${summary.passes} checks passed · ${summary.warnings} warning(s) · ${report.active_backend ?? "NO"} backend`
                : `NOT READY · ${summary.failures} required check(s) failed · ${summary.warnings} warning(s)`;
        } catch (error) {
            status.dataset.tone = "error";
            status.textContent = `PREFLIGHT ERROR · ${error}`;
        } finally {
            button.disabled = false;
            button.textContent = "RUN PREFLIGHT";
            node.setDirtyCanvas?.(true, true);
        }
    };
    button.addEventListener("click", run);
    node.__vvH3RunPreflight = run;
    addDom(node, "vv_h3_preflight_surface", shell, 320);
    if (Boolean(widgetValue(node, "auto_check_on_load", true))) {
        setTimeout(() => node.graph && run(), 1300);
    }
}

function installTimer(node) {
    if (typeOf(node) !== TIMER || node.__vvH3TimerInstalled) return;
    node.__vvH3TimerInstalled = true;
    const shell = document.createElement("div");
    shell.className = "vvh3-monitor";
    shell.innerHTML = `<div class="vvh3m-head">VELVET VICE · H3 RENDER TIMER</div><div class="vvh3m-body"><div class="vvh3m-status" data-tone="ready">READY · last render ${fmt(lastElapsed)}</div><div class="vvh3m-grid"><div class="vvh3m-card"><span>Current</span><strong data-time="current">00:00:00</strong></div><div class="vvh3m-card"><span>H3 Core</span><strong data-time="core">00:00:00</strong></div><div class="vvh3m-card"><span>Total</span><strong data-time="total">00:00:00</strong></div><div class="vvh3m-card"><span>Last Render</span><strong data-time="last">${fmt(lastElapsed)}</strong></div></div></div>`;
    const timer = {
        node,
        status: shell.querySelector(".vvh3m-status"),
        current: shell.querySelector('[data-time="current"]'),
        core: shell.querySelector('[data-time="core"]'),
        total: shell.querySelector('[data-time="total"]'),
        last: shell.querySelector('[data-time="last"]'),
    };
    node.__vvH3Timer = timer;
    timers.add(timer);
    addDom(node, "vv_h3_render_timer_surface", shell, 215);
    const enabledWidget = widget(node, "enabled");
    if (enabledWidget && !enabledWidget.__vvH3TimerWrapped) {
        enabledWidget.__vvH3TimerWrapped = true;
        const original = enabledWidget.callback;
        enabledWidget.callback = function(value) {
            original?.call(this, value);
            refreshTimers();
        };
    }
    refreshTimers();
}

function timerEnabled(timer) {
    return Boolean(widgetValue(timer.node, "enabled", true));
}

function refreshTimers(now = performance.now()) {
    const total = running && totalStarted != null ? now - totalStarted : totalElapsed;
    const current = running && currentStarted != null ? now - currentStarted : currentElapsed;
    const core = coreElapsed + (running && coreStarted != null ? now - coreStarted : 0);
    for (const timer of timers) {
        const enabled = timerEnabled(timer);
        timer.current.textContent = enabled ? fmt(current) : "PAUSED";
        timer.core.textContent = enabled ? fmt(core) : "PAUSED";
        timer.total.textContent = enabled ? fmt(total) : "PAUSED";
        timer.last.textContent = fmt(lastElapsed);
        if (!enabled) {
            timer.status.dataset.tone = "";
            timer.status.textContent = `PAUSED · last render ${fmt(lastElapsed)}`;
        } else if (running) {
            timer.status.dataset.tone = "working";
            timer.status.textContent = `WORKING · ${currentLabel}`;
        }
    }
}

function ensureAnimation() {
    if (animationFrame != null) return;
    const tick = (now) => {
        if (!monitors.size || !running) {
            animationFrame = null;
            return;
        }
        refreshTimers(now);
        animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
}

function stopCore(now) {
    if (coreStarted == null) return;
    coreElapsed += now - coreStarted;
    coreStarted = null;
}

function finishRun(kind, message) {
    if (!running || totalStarted == null) return;
    const now = performance.now();
    stopCore(now);
    totalElapsed = now - totalStarted;
    currentElapsed = currentStarted == null ? 0 : now - currentStarted;
    running = false;
    totalStarted = null;
    currentStarted = null;
    currentLabel = message;
    if (kind === "success") {
        lastElapsed = totalElapsed;
        localStorage.setItem(LAST_RENDER_KEY, String(lastElapsed));
    }
    refreshTimers(now);
    for (const timer of timers) {
        if (!timerEnabled(timer)) continue;
        timer.status.dataset.tone = kind === "success" ? "ready" : "error";
        timer.status.textContent = kind === "success"
            ? `DONE · total ${fmt(totalElapsed)} · H3 core ${fmt(coreElapsed)}`
            : `${message} · elapsed ${fmt(totalElapsed)}`;
    }
}

function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    api.addEventListener("execution_start", () => {
        if (!isH3Graph()) return;
        const now = performance.now();
        running = true;
        totalStarted = now;
        currentStarted = now;
        coreStarted = null;
        coreElapsed = 0;
        totalElapsed = 0;
        currentElapsed = 0;
        currentLabel = "Preparing Velvet Vice H3";
        refreshTimers(now);
        ensureAnimation();
    });
    api.addEventListener("executing", ({ detail }) => {
        if (!running || !isH3Graph()) return;
        const now = performance.now();
        const node = graphNode(eventNodeId(detail));
        currentStarted = now;
        currentElapsed = 0;
        currentLabel = node?.title ?? (eventNodeId(detail) == null ? "Finalizing" : `Node ${eventNodeId(detail)}`);
        if (isCore(node)) {
            if (coreStarted == null) coreStarted = now;
        } else {
            stopCore(now);
        }
        refreshTimers(now);
    });
    api.addEventListener("execution_success", () => finishRun("success", "DONE"));
    api.addEventListener("execution_error", ({ detail }) => finishRun("error", `ERROR · ${detail?.exception_message ?? "Execution failed"}`));
    api.addEventListener("execution_interrupted", () => finishRun("error", "CANCELLED"));
}

function install(node) {
    installStyle();
    installPreflight(node);
    installTimer(node);
}

installListeners();

app.registerExtension({
    name: "VelvetVice.MiniMaxH3.MonitorsV140",
    nodeCreated(node) { install(node); },
    loadedGraphNode(node) { install(node); },
    afterConfigureGraph() {
        for (const node of app.graph?._nodes ?? []) install(node);
        refreshTimers();
    },
    nodeRemoved(node) {
        monitors.delete(node);
        if (node.__vvH3Timer) timers.delete(node.__vvH3Timer);
    },
});
