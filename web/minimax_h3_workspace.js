import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const SYSTEM = "VelvetViceMiniMaxH3SystemHub";
const DIRECTOR = "VelvetViceMiniMaxH3Director";
const PROFILE = "VelvetViceMiniMaxH3ProfileManager";
const POWER_LORA = "VelvetViceMiniMaxH3PowerLoraAV";
const TURBO = "VelvetViceMiniMaxH3TurboDirector";
const OUTPUT_HUB = "VelvetViceMiniMaxH3OutputHub";
const OUTPUT_STUDIO = "VelvetViceMiniMaxH3OutputStudio";
const WATERMARK_NODE = "VelvetViceMiniMaxH3WatermarkOverlay";
const PACK_VERSION = "1.4.4";

// H3-only Director visual runtime. This is deliberately isolated from the
// H3-scoped design system; color changes remain local to this package.
const h3DirectorSurfaces = new Map();
let h3DirectorRuntimeListenersInstalled = false;

function eventNodeId(detail) {
    if (detail == null) return null;
    if (typeof detail === "string" || typeof detail === "number") return String(detail);
    const raw = detail.node ?? detail.node_id ?? detail.id ?? null;
    return raw == null ? null : String(raw).split(":")[0];
}

function installH3DirectorRuntimeListeners() {
    if (h3DirectorRuntimeListenersInstalled) return;
    h3DirectorRuntimeListenersInstalled = true;
    api.addEventListener("execution_start", () => {
        for (const surface of h3DirectorSurfaces.values()) surface.setRuntimeTone?.("queued");
    });
    api.addEventListener("executing", ({ detail }) => {
        const activeId = eventNodeId(detail);
        if (activeId == null) return;
        for (const [nodeId, surface] of h3DirectorSurfaces.entries()) {
            if (nodeId === activeId) surface.setRuntimeTone?.("active");
            else if (surface.runtimeTone === "active") surface.setRuntimeTone?.("ready");
        }
    });
    api.addEventListener("execution_error", ({ detail }) => {
        const failedId = eventNodeId(detail);
        for (const [nodeId, surface] of h3DirectorSurfaces.entries()) {
            if (failedId == null || failedId === nodeId) surface.setRuntimeTone?.("error");
        }
    });
    api.addEventListener("execution_interrupted", () => {
        for (const surface of h3DirectorSurfaces.values()) surface.setRuntimeTone?.("warning");
    });
    api.addEventListener("execution_success", () => {
        for (const surface of h3DirectorSurfaces.values()) surface.setRuntimeTone?.("ready");
    });
}

function typeOf(node) { return node?.comfyClass ?? node?.type; }
function widget(node, name) { return node?.widgets?.find((w) => w?.name === name); }
function value(node, name, fallback = null) { const w = widget(node, name); return w == null ? fallback : w.value; }
function setValue(node, name, v, callback = true) {
    const w = widget(node, name); if (!w) return false;
    w.value = v; if (callback) w.callback?.(v);
    node.__vvh3SyncControls?.();
    node.graph?.setDirtyCanvas?.(true, true); node.setDirtyCanvas?.(true, true); return true;
}
function hideWidget(w) {
    if (!w || w.__vvh3Hidden) return;
    w.__vvh3Hidden = true; w.hidden = true;
    w.computeSize = () => [0, -4];
}
function hideNative(node, keep = []) {
    const allow = new Set(keep);
    for (const w of node.widgets ?? []) if (!allow.has(w.name)) hideWidget(w);
}
function ensureMinimumNodeSize(node, width, height) {
    if (!node) return;
    node.resizable = true;
    const currentWidth = Number(node.size?.[0] ?? 0);
    const currentHeight = Number(node.size?.[1] ?? 0);
    if (currentWidth < width || currentHeight < height) {
        node.setSize?.([Math.max(width, currentWidth), Math.max(height, currentHeight)]);
    }
}
function addDom(node, name, el, height) {
    el.style.width = "100%"; el.style.height = "100%"; el.style.minHeight = `${height}px`; el.style.overflowY = "auto";
    const dw = node.addDOMWidget(name, name, el, {
        serialize: false, hideOnZoom: false, margin: 0,
        getMinHeight: () => height, getMaxHeight: () => Infinity, getHeight: () => height,
    });
    dw.serialize = false; dw.serializeValue = () => undefined;
    dw.computeSize = (width) => [width, height];
    dw.computeLayoutSize = () => ({ minHeight: height, maxHeight: Infinity, minWidth: 0, maxWidth: Infinity });
    node.resizable = true;
    return dw;
}
function optionsFor(node, name) {
    const w = widget(node, name);
    const vals = w?.options?.values;
    return Array.isArray(vals) ? vals.map(String) : [];
}
function selectControl(node, name, label, onChange = null) {
    const wrap = document.createElement("label"); wrap.className = "vvh3-field";
    const cap = document.createElement("span"); cap.textContent = label; wrap.appendChild(cap);
    const sel = document.createElement("select");
    const opts = optionsFor(node, name); const current = String(value(node, name, ""));
    for (const item of opts.length ? opts : [current]) { const o = document.createElement("option"); o.value = item; o.textContent = item; sel.appendChild(o); }
    sel.value = current;
    sel.addEventListener("change", () => { setValue(node, name, sel.value); onChange?.(sel.value); });
    wrap.appendChild(sel);
    const sync = () => { const v = String(value(node, name, "")); if ([...sel.options].some((o)=>o.value===v)) sel.value = v; };
    return { wrap, control: sel, sync };
}
function numberControl(node, name, label, step = "1") {
    const wrap = document.createElement("label"); wrap.className = "vvh3-field";
    const cap = document.createElement("span"); cap.textContent = label; wrap.appendChild(cap);
    const input = document.createElement("input"); input.type = "number"; input.step = step; input.value = value(node, name, 0);
    const commit = () => {
        const next = Number(input.value);
        if (!Number.isFinite(next)) return;
        setValue(node, name, next);
    };
    // Update the actual hidden ComfyUI widget immediately while typing. Using
    // only `change` allowed the visible DOM value to differ from the queued
    // widget value until focus was lost.
    input.addEventListener("input", commit);
    input.addEventListener("change", commit);
    wrap.appendChild(input);
    const sync = () => { input.value = value(node, name, 0); };
    return { wrap, control: input, sync };
}
function toggleControl(node, name, label) {
    const wrap = document.createElement("label"); wrap.className = "vvh3-toggle";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = !!value(node, name, false);
    const span = document.createElement("span"); span.textContent = label;
    input.addEventListener("change", () => setValue(node, name, input.checked));
    wrap.append(input, span);
    const sync = () => { input.checked = !!value(node, name, false); };
    return { wrap, control: input, sync };
}
function section(title) { const d = document.createElement("div"); d.className = "vvh3-section"; const h = document.createElement("div"); h.className = "vvh3-section-title"; h.textContent = title; d.appendChild(h); return d; }
function grid(...elements) { const d = document.createElement("div"); d.className = "vvh3-grid"; for (const e of elements) d.appendChild(e.wrap ?? e); return d; }
function statusBox(text = "NOT CHECKED") { const d = document.createElement("div"); d.className = "vvh3-status"; d.textContent = text; return d; }
function wrapExecuted(node, callback) {
    if (node.__vvh3ExecutedWrapped) return;
    node.__vvh3ExecutedWrapped = true;
    const original = node.onExecuted;
    node.onExecuted = function(message) { try { original?.call(this, message); } finally { callback(message ?? {}); } };
}
function installStyles() {
    if (document.getElementById("vvh3-workspace-style")) return;
    const style = document.createElement("style"); style.id = "vvh3-workspace-style";
    style.textContent = `
      .vvh3-shell{box-sizing:border-box;height:100%;padding:10px;background:linear-gradient(145deg,#171f28,#202b36);color:#dce2e8;font-family:Inter,Arial,sans-serif;overflow:auto;border-radius:10px}
      .vvh3-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.vvh3-title{font-size:12px;font-weight:900;letter-spacing:.08em}.vvh3-version{font-size:8px;color:#8d9aa6}
      .vvh3-section{padding:9px;margin-top:8px;border:1px solid rgba(191,177,210,.12);border-radius:9px;background:#151e27}.vvh3-section-title{margin-bottom:7px;font-size:8px;font-weight:900;letter-spacing:.11em;color:#a896bc;text-transform:uppercase}
      .vvh3-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.vvh3-field{display:flex;min-width:0;flex-direction:column;gap:4px}.vvh3-field>span{font-size:7px;font-weight:850;letter-spacing:.065em;color:#919da8;text-transform:uppercase}
      .vvh3-field select,.vvh3-field input,.vvh3-profile-name{min-width:0;width:100%;box-sizing:border-box;height:29px;border:1px solid rgba(195,180,214,.14);border-radius:6px;background:#0f171f;color:#e6e2e9;padding:4px 7px;font-size:8.5px}
      .vvh3-toggle{display:flex;align-items:center;gap:7px;min-height:29px;padding:0 8px;border:1px solid rgba(195,180,214,.12);border-radius:6px;background:#111920;color:#c5ccd3;font-size:8px;font-weight:750}.vvh3-toggle input{accent-color:#8d73a4}
      .vvh3-status{margin-top:9px;padding:8px 9px;border:1px solid rgba(154,203,168,.20);border-radius:7px;background:#101a18;color:#a9d7b5;font-size:8px;font-weight:800;line-height:1.4;overflow-wrap:anywhere}.vvh3-status.warn{border-color:rgba(218,175,114,.25);background:#201a12;color:#e0bd8e}.vvh3-status.bad{border-color:rgba(218,112,124,.25);background:#241417;color:#e4a0a8}
      .vvh3-summary{margin-top:8px;padding:8px;border-radius:7px;background:#111920;color:#aeb9c4;font-size:8px;line-height:1.45;overflow-wrap:anywhere}.vvh3-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.vvh3-button{appearance:none;flex:1 1 82px;height:29px;border:1px solid rgba(195,180,214,.18);border-radius:7px;background:#222e3a;color:#dbe1e7;font-size:8px;font-weight:850;cursor:pointer}.vvh3-button:hover{background:#304052}.vvh3-button.danger:hover{background:#532934}.vvh3-profile-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px}.vvh3-modified{font-size:8px;font-weight:900;letter-spacing:.06em}.vvh3-modified.dirty{color:#e3b47b}.vvh3-modified.clean{color:#9ed0aa}
      .vvh3-director-shell{--h3-a:#8a69a5;--h3-b:#668ba5;--h3-fel:#829d70;--h3-glow:rgba(136,99,168,.16);--h3-soft:rgba(189,157,216,.26);position:relative;padding:12px;background:linear-gradient(150deg,#131b24,#1a2530);transition:border-color .28s ease,box-shadow .28s ease,background .45s ease}.vvh3-director-shell::before{content:"";pointer-events:none;position:absolute;inset:0;border-radius:10px;border:1px solid var(--h3-soft);box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 0 22px var(--h3-glow);opacity:.55;transition:opacity .3s ease,border-color .3s ease,box-shadow .3s ease}.vvh3-director-shell[data-tone="queued"]{--h3-a:#80649b;--h3-b:#5c819d;--h3-glow:rgba(105,139,169,.18)}.vvh3-director-shell[data-tone="active"]{--h3-a:#a77ac4;--h3-b:#6d91b0;--h3-fel:#8fac72;--h3-glow:rgba(111,150,155,.22);--h3-soft:rgba(157,150,183,.40)}.vvh3-director-shell[data-tone="ready"]{--h3-a:#8870a2;--h3-b:#5b8f83;--h3-glow:rgba(92,155,129,.16);--h3-soft:rgba(127,187,154,.28)}.vvh3-director-shell[data-tone="turbo"]{--h3-a:#a060c2;--h3-b:#697cc0;--h3-glow:rgba(152,86,189,.24);--h3-soft:rgba(190,123,219,.38)}.vvh3-director-shell[data-tone="warning"]{--h3-a:#b78458;--h3-b:#8a6c5e;--h3-glow:rgba(198,138,81,.20);--h3-soft:rgba(218,164,106,.34)}.vvh3-director-shell[data-tone="error"]{--h3-a:#b66477;--h3-b:#7d586a;--h3-glow:rgba(190,79,100,.22);--h3-soft:rgba(217,105,125,.38)}
      .vvh3-director-shell .vvh3-head{position:relative;overflow:hidden;padding-bottom:9px;border-bottom:1px solid var(--h3-soft);transition:border-color .3s ease}.vvh3-director-shell .vvh3-head::after{content:"";pointer-events:none;position:absolute;left:-45%;right:-45%;bottom:0;height:2px;background:linear-gradient(90deg,transparent,var(--h3-a),var(--h3-b),var(--h3-fel),transparent);opacity:.70;transform:translateX(-18%);transition:opacity .25s ease}.vvh3-director-shell[data-tone="active"] .vvh3-head::after{animation:vvh3-director-sweep 2.3s ease-in-out infinite;opacity:.92}.vvh3-director-shell[data-tone="queued"] .vvh3-head::after,.vvh3-director-shell[data-tone="turbo"] .vvh3-head::after{animation:none;opacity:.72}@keyframes vvh3-director-sweep{0%{transform:translateX(-28%)}100%{transform:translateX(28%)}}
      .vvh3-director-shell .vvh3-section{transition:border-color .28s ease,box-shadow .28s ease,background .28s ease}.vvh3-director-shell .vvh3-section:hover{border-color:var(--h3-soft);box-shadow:0 0 16px var(--h3-glow)}.vvh3-step-title{display:flex;align-items:center;gap:7px;margin-bottom:8px;font-size:8px;font-weight:900;letter-spacing:.10em;color:color-mix(in srgb,var(--h3-a) 68%,#d9c8e7);text-transform:uppercase;transition:color .28s ease}.vvh3-step-num{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:color-mix(in srgb,var(--h3-a) 26%,#1a2028);color:#e1d2eb;border:1px solid var(--h3-soft);font-size:8px;box-shadow:0 0 10px var(--h3-glow);transition:background .28s ease,border-color .28s ease,box-shadow .28s ease}
      .vvh3-segments{display:grid;grid-template-columns:repeat(var(--vv-count,3),minmax(0,1fr));gap:5px}.vvh3-segment{min-width:0;height:31px;padding:0 7px;border:1px solid rgba(190,171,208,.12);border-radius:7px;background:#101820;color:#9ca7b1;font-size:8px;font-weight:850;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .22s ease,border-color .22s ease,color .22s ease,box-shadow .22s ease,transform .16s ease}.vvh3-segment.active{background:linear-gradient(135deg,color-mix(in srgb,var(--h3-a) 48%,#202934),color-mix(in srgb,var(--h3-b) 43%,#202934));border-color:var(--h3-soft);color:#f2edf5;box-shadow:0 0 13px var(--h3-glow),0 0 0 1px rgba(255,255,255,.025) inset}.vvh3-segment:hover{border-color:var(--h3-soft);transform:translateY(-1px)}
      .vvh3-resolution-panel{margin-top:8px;padding:9px;border:1px solid rgba(186,165,205,.10);border-radius:8px;background:#0f171f;transition:border-color .25s ease,box-shadow .25s ease}.vvh3-director-shell[data-resolution="PRESET"] .vvh3-resolution-panel{border-color:color-mix(in srgb,var(--h3-a) 42%,transparent)}.vvh3-director-shell[data-resolution="CUSTOM MP"] .vvh3-resolution-panel{border-color:color-mix(in srgb,var(--h3-b) 46%,transparent)}.vvh3-director-shell[data-resolution="CUSTOM SIZE"] .vvh3-resolution-panel{border-color:color-mix(in srgb,var(--h3-a) 30%,var(--h3-b) 30%)}.vvh3-output-readout{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin-top:8px;padding:9px 10px;border:1px solid rgba(114,180,149,.16);border-radius:8px;background:#0f1a19;transition:border-color .28s ease,box-shadow .28s ease}.vvh3-director-shell[data-tone="ready"] .vvh3-output-readout{border-color:rgba(107,190,145,.30);box-shadow:0 0 14px rgba(80,150,117,.09)}.vvh3-output-readout strong{display:block;color:#dfe6e2;font-size:9px}.vvh3-output-readout span{display:block;margin-top:2px;color:#86a599;font-size:7.5px}.vvh3-grid-ok{padding:4px 7px;border-radius:999px;background:#14251e;color:#90d0aa;border:1px solid rgba(102,190,139,.18);font-size:7px;font-weight:900;white-space:nowrap}
      .vvh3-details{margin-top:8px;border:1px solid rgba(186,165,205,.11);border-radius:8px;background:#111920;overflow:hidden}.vvh3-details summary{padding:9px 10px;cursor:pointer;list-style:none;color:#aeb8c2;font-size:8px;font-weight:900;letter-spacing:.075em;text-transform:uppercase}.vvh3-details summary::-webkit-details-marker{display:none}.vvh3-details[open] summary{border-bottom:1px solid rgba(255,255,255,.055);color:#c5b2d4}.vvh3-details-body{padding:9px}
      .vvh3-ready{margin-top:9px;padding:9px 10px;border:1px solid rgba(96,180,129,.18);border-radius:8px;background:linear-gradient(135deg,#102019,#111b1b);color:#9ed5b0;font-size:8px;font-weight:850;line-height:1.45}.vvh3-ready strong{color:#c9ead4;font-size:9px}
      .vvh3-output-sub{margin-top:3px;font-size:7px;color:#7f8e9a;letter-spacing:.055em;text-transform:uppercase}
      .vvh3-output-hub-shell .vvh3-section{background:linear-gradient(145deg,#121b24,#151f28)}
      .vvh3-inline-status{margin-top:7px;padding:6px 8px;border-radius:6px;background:#0f171e;color:#788793;font-size:7.3px;line-height:1.4}
      .vvh3-decoder-status{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:center;padding:8px 9px;border:1px solid rgba(139,163,116,.16);border-radius:7px;background:#101917;color:#a9b8ae;font-size:7.4px;line-height:1.35}.vvh3-decoder-status strong{font-size:8px;color:#c8d6cd;letter-spacing:.04em}.vvh3-decoder-dot{width:8px;height:8px;border-radius:50%;background:#73808b;box-shadow:0 0 0 3px rgba(115,128,139,.08)}.vvh3-decoder-status.installed{border-color:rgba(141,163,116,.26);background:#111b17}.vvh3-decoder-status.installed .vvh3-decoder-dot{background:#8da374;box-shadow:0 0 10px rgba(141,163,116,.22)}.vvh3-decoder-status.optional{border-color:rgba(110,139,164,.19);background:#101820}.vvh3-decoder-status.optional .vvh3-decoder-dot{background:#6f8ca4}
      .vvh3-watermark-state{display:flex;align-items:center;min-height:29px;padding:0 9px;border:1px solid rgba(174,151,197,.11);border-radius:6px;background:#101820;color:#778590;font-size:7.4px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .vvh3-watermark-state.on{border-color:rgba(137,171,112,.24);background:#121b18;color:#aabf9e}
      .vvh3-watermark-file-row{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:7px;align-items:end;margin-bottom:7px}.vvh3-upload{height:29px;flex:none}.vvh3-watermark-details{margin-top:7px}
      .vvh3-section.is-enabled{border-color:rgba(134,169,109,.22);box-shadow:0 0 16px rgba(101,141,80,.055)}
      @media(max-width:620px){.vvh3-grid{grid-template-columns:1fr}.vvh3-segments{grid-template-columns:repeat(2,minmax(0,1fr))}.vvh3-output-readout{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
}

function installSystemHub(node) {
    if (node.__vvh3SystemInstalled) return; node.__vvh3SystemInstalled = true;
    hideNative(node); node.__vvSuppressCanvasChromeV1115 = true;
    const shell = document.createElement("div"); shell.className = "vvh3-shell vvh3-themed-shell"; shell.dataset.h3Role = "setup"; node.__vvh3Shell = shell;
    const head = document.createElement("div"); head.className = "vvh3-head"; head.innerHTML = `<div class="vvh3-title">H3 SYSTEM HUB</div><div class="vvh3-version">${PACK_VERSION} · AUTO PERSIST</div>`; shell.appendChild(head);
    const controls = [];
    const keep = (ctl) => { controls.push(ctl); return ctl; };
    const backend = section("Model Backend · Native / GGUF");
    const backendCtl = keep(selectControl(node,"model_backend","Backend"));
    const autoPref = keep(selectControl(node,"auto_preference","AUTO Preference"));
    backend.appendChild(grid(backendCtl,autoPref));
    backend.appendChild(grid(keep(selectControl(node,"native_model","Native Model")), keep(selectControl(node,"gguf_model","GGUF Model"))));
    backend.appendChild(grid(keep(toggleControl(node,"fallback_if_missing","Fallback if backend missing")),keep(toggleControl(node,"unload_on_backend_change","Release previous backend on switch"))));
    shell.appendChild(backend);
    const core = section("Encoder + VAE");
    core.appendChild(grid(keep(selectControl(node,"text_encoder","Qwen Text Encoder · Native / GGUF")),keep(selectControl(node,"text_encoder_device","Encoder Device · Native"))));
    core.appendChild(grid(keep(selectControl(node,"video_vae","Video VAE · Native")),keep(selectControl(node,"audio_vae","Audio VAE · Native"))));
    const vaeHint=document.createElement("div");vaeHint.className="vvh3-inline-status";vaeHint.textContent="GGUF: diffusion model + Qwen encoder supported. Video/audio VAEs use native ComfyUI VAE files.";core.appendChild(vaeHint);shell.appendChild(core);
    const turbo = section("Turbo / Distilled LoRA");
    turbo.appendChild(grid(keep(selectControl(node,"turbo_lora","Turbo LoRA")),keep(numberControl(node,"turbo_model_strength","Model Strength","0.01"))));
    turbo.appendChild(grid(keep(numberControl(node,"base_steps","Base Steps","1")),keep(numberControl(node,"turbo_steps","Turbo Steps","1"))));
    turbo.appendChild(grid(keep(toggleControl(node,"strict_turbo_compatibility","Strict H3 compatibility")),keep(toggleControl(node,"turbo_bypass_on_missing","Bypass to base if missing"))));
    const turboHint=document.createElement("div"); turboHint.className="vvh3-summary"; turboHint.textContent="Master switch remains in H3 Director · AVAILABLE/READY means the LoRA file exists; TURBO in Director means it is requested for the render."; turbo.appendChild(turboHint); shell.appendChild(turbo);
    const previewDecoder = section("Live Preview Decoder · Optional");
    const decoderStatus=document.createElement("div");decoderStatus.className="vvh3-decoder-status optional";decoderStatus.innerHTML='<span class="vvh3-decoder-dot"></span><div><strong>CHECKING TAEHV…</strong><br>AUTO/MEDIUM prefer TAEHV · HIGH uses full H3 Video VAE · LOW uses latent2rgb.</div>';previewDecoder.appendChild(decoderStatus);shell.appendChild(previewDecoder);
    const runtime = section("Native Runtime"); runtime.appendChild(grid(keep(selectControl(node,"native_weight_dtype","Weight dtype")))); shell.appendChild(runtime);
    const status = statusBox("SYSTEM STATUS · restoring last H3 System Hub state…"); shell.appendChild(status);

    async function refreshPreviewDecoderStatus(){
        try{
            const info=await requestJson("/velvet_vice/h3/preview_decoder");
            decoderStatus.className=`vvh3-decoder-status ${info.installed?"installed":"optional"}`;
            decoderStatus.innerHTML=info.installed
                ? `<span class="vvh3-decoder-dot"></span><div><strong>TAEHV INSTALLED</strong><br>${info.relative_path} · AUTO/MEDIUM = TAEHV · HIGH = Full H3 Video VAE · LOW = latent2rgb.</div>`
                : `<span class="vvh3-decoder-dot"></span><div><strong>TAEHV OPTIONAL · NOT INSTALLED</strong><br>AUTO/MEDIUM fall back to latent2rgb · HIGH still uses Full H3 Video VAE. Run _INSTALL_H3_PREVIEW_TAEHV.cmd for the recommended medium preview path.</div>`;
        }catch(e){
            decoderStatus.className="vvh3-decoder-status optional";
            decoderStatus.innerHTML=`<span class="vvh3-decoder-dot"></span><div><strong>TAEHV STATUS UNAVAILABLE</strong><br>${e.message} · Preview rendering itself remains fail-safe.</div>`;
        }
    }

    const syncControls = () => { for (const ctl of controls) ctl.sync?.(); };
    node.__vvh3SyncControls = syncControls;
    let restoring = true;
    let saveTimer = null;
    const systemPayload = () => captureNode(node, CAPTURE[SYSTEM]);
    const saveNow = async () => {
        if (restoring) return;
        try {
            await requestJson("/velvet_vice/h3/state/system", { payload: systemPayload() });
        } catch (e) {
            status.textContent = `PERSISTENCE WARNING · ${e.message}`;
            status.className = "vvh3-status warn";
        }
    };
    const scheduleSave = () => {
        if (restoring) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, 180);
    };
    node.__vvh3Persist = scheduleSave;
    node.__vvh3SystemCleanup = () => {
        clearTimeout(saveTimer);
        // Workflow switching removes the node immediately. Flush the latest
        // visible state instead of discarding a pending debounce save.
        void saveNow();
    };
    shell.addEventListener("input", scheduleSave);
    shell.addEventListener("change", scheduleSave);

    async function restoreState() {
        let unavailable = 0;
        try {
            const response = await requestJson("/velvet_vice/h3/state/system");
            const payload = response?.state?.payload ?? {};
            for (const [name, persisted] of Object.entries(payload)) {
                const w = widget(node, name); if (!w) continue;
                const values = Array.isArray(w?.options?.values) ? w.options.values.map(String) : null;
                if (values && !values.includes(String(persisted))) { unavailable += 1; continue; }
                setValue(node, name, persisted, false);
            }
            syncControls();
            status.textContent = unavailable
                ? `SYSTEM SETTINGS RESTORED · ${unavailable} stored selection(s) are no longer installed`
                : "SYSTEM SETTINGS RESTORED · Native/GGUF selections persist across workflow switches";
            status.className = unavailable ? "vvh3-status warn" : "vvh3-status";
        } catch (e) {
            status.textContent = `PERSISTENCE WARNING · ${e.message}`;
            status.className = "vvh3-status warn";
        } finally {
            restoring = false;
        }
    }

    wrapExecuted(node,(msg)=>{ const text = Array.isArray(msg.status)?msg.status[0]:msg.status; if(!text)return; status.textContent=text; status.className="vvh3-status"; status.classList.toggle("bad",/NOT READY/i.test(text)); status.classList.toggle("warn",/FALLBACK/i.test(text)); });
    restoreState();
    refreshPreviewDecoderStatus();
    addDom(node,"vvh3_system_surface",shell,790); ensureMinimumNodeSize(node,690,850);
}
function installDirector(node) {
    if (node.__vvh3DirectorInstalled) return; node.__vvh3DirectorInstalled = true;
    hideNative(node); node.__vvSuppressCanvasChromeV1115 = true;
    const shell = document.createElement("div"); shell.className = "vvh3-shell vvh3-themed-shell vvh3-director-shell"; shell.dataset.h3Role = "setup"; node.__vvh3Shell = shell; shell.dataset.tone = "idle"; shell.dataset.resolution = String(value(node,"resolution_mode","PRESET") || "PRESET").toUpperCase();
    const runtimeSurface = { runtimeTone: "idle", setRuntimeTone(tone){ this.runtimeTone = tone; shell.dataset.tone = tone; node.graph?.setDirtyCanvas?.(true,true); node.setDirtyCanvas?.(true,true); } };
    h3DirectorSurfaces.set(String(node.id), runtimeSurface);
    installH3DirectorRuntimeListeners();
    const head = document.createElement("div"); head.className = "vvh3-head"; head.innerHTML = `<div><div class="vvh3-title">MINIMAX H3 DIRECTOR</div><div class="vvh3-version">I2V RENDER CONTROL · AUTO PERSIST</div></div><div class="vvh3-version">${PACK_VERSION}</div>`; shell.appendChild(head);
    const controls = [];
    const keep = (ctl) => { controls.push(ctl); return ctl; };
    const stepSection = (number, title) => { const box=document.createElement("div");box.className="vvh3-section";const h=document.createElement("div");h.className="vvh3-step-title";h.innerHTML=`<span class="vvh3-step-num">${number}</span><span>${title}</span>`;box.appendChild(h);return box; };
    const segmented = (name, onChange=null) => {
        const wrap=document.createElement("div");wrap.className="vvh3-segments";
        const values=optionsFor(node,name);wrap.style.setProperty("--vv-count",String(Math.max(1,values.length)));
        const buttons=values.map((item)=>{const b=document.createElement("button");b.type="button";b.className="vvh3-segment";b.textContent=item;b.title=item;b.onclick=()=>{setValue(node,name,item);sync();onChange?.(item);scheduleSave();};wrap.appendChild(b);return {item,b};});
        const sync=()=>{const current=String(value(node,name,""));for(const entry of buttons)entry.b.classList.toggle("active",entry.item===current);};
        const ctl={wrap,control:wrap,sync};controls.push(ctl);sync();return ctl;
    };
    const booleanSegmented = (name, trueLabel, falseLabel) => {
        const field=document.createElement("div");field.className="vvh3-field";
        const cap=document.createElement("span");cap.textContent="Audio Output";field.appendChild(cap);
        const wrap=document.createElement("div");wrap.className="vvh3-segments";wrap.style.setProperty("--vv-count","2");field.appendChild(wrap);
        const choices=[[true,trueLabel],[false,falseLabel]].map(([state,label])=>{const b=document.createElement("button");b.type="button";b.className="vvh3-segment";b.textContent=label;b.title=label;b.onclick=()=>{setValue(node,name,state);sync();scheduleSave();};wrap.appendChild(b);return {state,b};});
        const sync=()=>{const current=!!value(node,name,true);for(const entry of choices)entry.b.classList.toggle("active",entry.state===current);};
        const ctl={wrap:field,control:wrap,sync};controls.push(ctl);sync();return ctl;
    };

    const render = stepSection("1","Render");
    const profileCtl=keep(selectControl(node,"render_preset","Performance Profile",(p)=>{
        const changes={TEST:{resolution_mode:"PRESET",resolution_preset:"480p",turbo_enabled:false},FAST:{resolution_mode:"PRESET",resolution_preset:"480p",turbo_enabled:true},BALANCED:{resolution_mode:"PRESET",resolution_preset:"0.65 MP - Balanced",turbo_enabled:false},QUALITY:{resolution_mode:"PRESET",resolution_preset:"1.00 MP - 1024p",turbo_enabled:false}}[p];
        if(changes){for(const [k,v] of Object.entries(changes))setValue(node,k,v);syncControls();scheduleSave();}
    }));
    const durationCtl=keep(numberControl(node,"duration_seconds","Duration (sec)","0.1"));
    render.appendChild(grid(profileCtl,durationCtl));
    const audioModeCtl=booleanSegmented("native_audio_output","WITH SOUND","MUTED · VIDEO ONLY");
    render.appendChild(grid(keep(toggleControl(node,"turbo_enabled","Turbo master switch")),audioModeCtl));
    const durationHint=document.createElement("div");durationHint.className="vvh3-summary";durationHint.textContent="Recommended H3 training range: about 5–15s. Longer generations remain available up to the native H3/ComfyUI limit (~149.7s).";render.appendChild(durationHint);shell.appendChild(render);

    const resolution=stepSection("2","Format & Resolution");
    const formatLabel=document.createElement("div");formatLabel.className="vvh3-section-title";formatLabel.textContent="Format";resolution.appendChild(formatLabel);
    const formatCtl=segmented("format_mode",()=>refresh());resolution.appendChild(formatCtl.wrap);
    const modeLabel=document.createElement("div");modeLabel.className="vvh3-section-title";modeLabel.style.marginTop="10px";modeLabel.textContent="Resolution Mode";resolution.appendChild(modeLabel);
    const resolutionModeCtl=segmented("resolution_mode",()=>{syncResolutionMode();refresh();});resolution.appendChild(resolutionModeCtl.wrap);
    const panel=document.createElement("div");panel.className="vvh3-resolution-panel";
    const presetCtl=keep(selectControl(node,"resolution_preset","Preset Resolution",refresh));
    const customMpCtl=keep(numberControl(node,"custom_megapixels","Target MP","0.1"));
    const customWidthCtl=keep(numberControl(node,"custom_width","Custom Width","32"));
    const customHeightCtl=keep(numberControl(node,"custom_height","Custom Height","32"));
    const presetGrid=grid(presetCtl),mpGrid=grid(customMpCtl),sizeGrid=grid(customWidthCtl,customHeightCtl);
    panel.append(presetGrid,mpGrid,sizeGrid);resolution.appendChild(panel);
    resolution.appendChild(grid(keep(toggleControl(node,"rotate_format","Rotate format"))));
    const outputReadout=document.createElement("div");outputReadout.className="vvh3-output-readout";const outputText=document.createElement("div");const outputStrong=document.createElement("strong");const outputSub=document.createElement("span");outputText.append(outputStrong,outputSub);const gridOk=document.createElement("div");gridOk.className="vvh3-grid-ok";gridOk.textContent="H3 GRID · 32px";outputReadout.append(outputText,gridOk);resolution.appendChild(outputReadout);shell.appendChild(resolution);

    const advanced=document.createElement("details");advanced.className="vvh3-details";const advSummary=document.createElement("summary");advSummary.textContent="Advanced Behaviour";advanced.appendChild(advSummary);const advBody=document.createElement("div");advBody.className="vvh3-details-body";advBody.appendChild(grid(keep(selectControl(node,"seed_mode","Seed Mode",refresh)),keep(numberControl(node,"seed","Seed","1"))));advBody.appendChild(grid(keep(selectControl(node,"ending_mode","Ending Mode"))));advanced.appendChild(advBody);shell.appendChild(advanced);

    const ready=document.createElement("div");ready.className="vvh3-ready";const readyTitle=document.createElement("strong");readyTitle.textContent="READY CONFIGURATION";const readyBody=document.createElement("div");ready.append(readyTitle,readyBody);shell.appendChild(ready);
    const status=statusBox("DIRECTOR STATE · restoring last settings…");shell.appendChild(status);

    function resolutionDetail(){const mode=String(value(node,"resolution_mode","PRESET")||"PRESET").toUpperCase();if(mode==="CUSTOM MP")return `${Number(value(node,"custom_megapixels",0.4)).toFixed(2)} MP`;if(mode==="CUSTOM SIZE")return `${value(node,"custom_width",1344)}×${value(node,"custom_height",768)}`;return String(value(node,"resolution_preset","900p"));}
    function syncResolutionMode(){const mode=String(value(node,"resolution_mode","PRESET")||"PRESET").toUpperCase();shell.dataset.resolution=mode;presetGrid.style.display=mode==="PRESET"?"grid":"none";mpGrid.style.display=mode==="CUSTOM MP"?"grid":"none";sizeGrid.style.display=mode==="CUSTOM SIZE"?"grid":"none";}
    function refresh(){const format=String(value(node,"format_mode","AUTO"));const mode=String(value(node,"resolution_mode","PRESET"));const detail=resolutionDetail();outputStrong.textContent=`${mode} · ${detail}`;outputSub.textContent=`Format ${format} · final pixel dimensions are H3-aligned at queue time`;readyBody.textContent=`${value(node,"duration_seconds",5)}s · ${format} · ${mode} ${detail} · ${value(node,"turbo_enabled",false)?"TURBO":"BASE"} · AUDIO ${value(node,"native_audio_output",true)?"WITH SOUND":"MUTED / VIDEO ONLY"}`;if(!["active","queued","error","warning"].includes(runtimeSurface.runtimeTone)){runtimeSurface.setRuntimeTone(value(node,"turbo_enabled",false)?"turbo":"ready");}}
    const syncControls=()=>{for(const ctl of controls)ctl.sync?.();syncResolutionMode();refresh();};node.__vvh3SyncControls=syncControls;
    let restoring=true;let saveTimer=null;const payload=()=>captureNode(node,CAPTURE[DIRECTOR]);
    const saveNow=async()=>{if(restoring)return;try{await requestJson("/velvet_vice/h3/state/director",{payload:payload()});if(runtimeSurface.runtimeTone==="warning")runtimeSurface.setRuntimeTone(value(node,"turbo_enabled",false)?"turbo":"ready");}catch(e){status.textContent=`PERSISTENCE WARNING · ${e.message}`;status.className="vvh3-status warn";runtimeSurface.setRuntimeTone("warning");}};
    const scheduleSave=()=>{if(restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,180);};node.__vvh3Persist=scheduleSave;node.__vvh3DirectorCleanup=()=>{clearTimeout(saveTimer);void saveNow();};
    shell.addEventListener("input",()=>{refresh();scheduleSave();});shell.addEventListener("change",()=>{refresh();scheduleSave();});
    async function restoreState(){try{const response=await requestJson("/velvet_vice/h3/state/director");const stored=response?.state?.payload??{};const legacyResolution={TEST:"480p",BALANCED:"0.65 MP - Balanced",QUALITY:"1.00 MP - 1024p"};for(const [name,persisted] of Object.entries(stored)){const w=widget(node,name);if(!w)continue;const restored=(name==="resolution_preset"&&legacyResolution[String(persisted).toUpperCase()])?legacyResolution[String(persisted).toUpperCase()]:persisted;const values=Array.isArray(w?.options?.values)?w.options.values.map(String):null;if(values&&!values.includes(String(restored)))continue;setValue(node,name,restored,false);}syncControls();status.textContent="DIRECTOR SETTINGS RESTORED · persistent across workflow switches";status.className="vvh3-status";runtimeSurface.setRuntimeTone(value(node,"turbo_enabled",false)?"turbo":"ready");}catch(e){status.textContent=`PERSISTENCE WARNING · ${e.message}`;status.className="vvh3-status warn";runtimeSurface.setRuntimeTone("warning");}finally{restoring=false;}}
    wrapExecuted(node,(msg)=>{const s=Array.isArray(msg.status)?msg.status[0]:msg.status;const sum=Array.isArray(msg.summary)?msg.summary[0]:msg.summary;if(sum){outputStrong.textContent="FINAL OUTPUT";outputSub.textContent=sum;readyBody.textContent=sum;}if(s){const failed=/NOT READY|ERROR/i.test(s);const warned=/WARNING|FALLBACK/i.test(s);status.textContent=s;status.className="vvh3-status";status.classList.toggle("bad",failed);status.classList.toggle("warn",!failed&&warned);runtimeSurface.setRuntimeTone(failed?"error":warned?"warning":value(node,"turbo_enabled",false)?"turbo":"ready");}});
    advanced.addEventListener("toggle",()=>node.setDirtyCanvas?.(true,true));restoreState();syncControls();addDom(node,"vvh3_director_surface",shell,625);ensureMinimumNodeSize(node,720,690);
}

function installOutputHub(node) {
    if (node.__vvh3OutputInstalled) return; node.__vvh3OutputInstalled = true;
    // The Hub owns its own watermark uploader. Do not let ComfyUI's native
    // image-upload preview expand this control node and collide with the
    // post-processing chain below it.
    node.imgs = null; node.imageIndex = null;
    hideNative(node); node.__vvSuppressCanvasChromeV1115 = true;
    const shell = document.createElement("div"); shell.className = "vvh3-shell vvh3-themed-shell vvh3-output-hub-shell"; shell.dataset.h3Role = "output"; node.__vvh3Shell = shell;
    const head = document.createElement("div"); head.className = "vvh3-head";
    head.innerHTML = `<div><div class="vvh3-title">H3 OUTPUT / FINISHING HUB</div><div class="vvh3-output-sub">Preview · post processing · watermark · project</div></div><div class="vvh3-version">H3 ONLY</div>`;
    shell.appendChild(head);
    const controls=[]; const keep=(ctl)=>{controls.push(ctl);return ctl;};

    const preview=section("Live Preview");
    preview.appendChild(grid(keep(toggleControl(node,"live_preview","Live Preview")),keep(selectControl(node,"preview_fps","Preview FPS"))));
    preview.appendChild(grid(keep(selectControl(node,"preview_quality","Preview Quality")),keep(selectControl(node,"preview_max_size","Preview Max Size"))));
    const hint=document.createElement("div"); hint.className="vvh3-summary"; hint.textContent="Preview settings apply to the next queued render. The final H3 output is never modified by preview quality."; preview.appendChild(hint); shell.appendChild(preview);

    const post=section("Post Processing");
    post.appendChild(grid(keep(toggleControl(node,"rife_48_fps","RIFE 48 FPS")),keep(toggleControl(node,"anti_ghost","Temporal Anti-Ghost"))));
    const postHint=document.createElement("div");postHint.className="vvh3-inline-status";postHint.textContent="Optional finishing stages · final encode remains single-pass";post.appendChild(postHint);shell.appendChild(post);

    const watermarkSec=section("Final Watermark");
    const watermarkToggle=keep(toggleControl(node,"watermark","Apply Watermark"));
    const watermarkState=document.createElement("div");watermarkState.className="vvh3-watermark-state";
    watermarkSec.appendChild(grid(watermarkToggle,watermarkState));

    const watermarkDetails=document.createElement("details");watermarkDetails.className="vvh3-details vvh3-watermark-details";
    const watermarkSummary=document.createElement("summary");watermarkSummary.textContent="Watermark Settings";watermarkDetails.appendChild(watermarkSummary);
    const watermarkBody=document.createElement("div");watermarkBody.className="vvh3-details-body";
    const watermarkFile=keep(selectControl(node,"watermark_file","Watermark File"));
    const fileRow=document.createElement("div");fileRow.className="vvh3-watermark-file-row";fileRow.appendChild(watermarkFile.wrap);
    const uploadButton=document.createElement("button");uploadButton.type="button";uploadButton.className="vvh3-button vvh3-upload";uploadButton.textContent="UPLOAD";fileRow.appendChild(uploadButton);watermarkBody.appendChild(fileRow);
    watermarkBody.appendChild(grid(keep(selectControl(node,"watermark_position","Position")),keep(numberControl(node,"watermark_scale","Scale","0.01"))));
    watermarkBody.appendChild(grid(keep(numberControl(node,"watermark_opacity","Opacity","0.01")),keep(numberControl(node,"watermark_margin_x","Margin X","1"))));
    watermarkBody.appendChild(grid(keep(numberControl(node,"watermark_margin_y","Margin Y","1"))));
    const watermarkHint=document.createElement("div");watermarkHint.className="vvh3-inline-status";watermarkHint.textContent="The processing node is internal. All user-facing watermark controls live here.";watermarkBody.appendChild(watermarkHint);
    watermarkDetails.appendChild(watermarkBody);watermarkSec.appendChild(watermarkDetails);shell.appendChild(watermarkSec);

    const output=section("Output Project");
    const projectWrap=document.createElement("label"); projectWrap.className="vvh3-field"; const projectCap=document.createElement("span"); projectCap.textContent="Project Name";
    const projectInput=document.createElement("input"); projectInput.type="text"; projectInput.value=value(node,"project_name",""); projectWrap.append(projectCap,projectInput); output.appendChild(projectWrap);
    const lastFrameStatus=document.createElement("div");lastFrameStatus.className="vvh3-inline-status";lastFrameStatus.textContent="LAST FRAME · decoded from the saved video and written beside it as PNG";output.appendChild(lastFrameStatus);shell.appendChild(output);

    const fileInput=document.createElement("input");fileInput.type="file";fileInput.accept="image/png,image/webp,image/jpeg";fileInput.style.display="none";shell.appendChild(fileInput);

    const syncProject=()=>{const out=findNode(OUTPUT_STUDIO);if(!out)return;let name=String(value(node,"project_name","VELVET_VICE_MINIMAX_H3_I2V_FINAL")||"VELVET_VICE_MINIMAX_H3_I2V_FINAL").trim();if(name.startsWith("video/"))name=name.slice(6);setValue(out,"filename_prefix",`video/${name}`,false);};
    const ensureWatermarkOption=(name)=>{
        const clean=String(name||"").trim();if(!clean)return;
        const native=widget(node,"watermark_file");const values=native?.options?.values;if(Array.isArray(values)&&!values.includes(clean))values.push(clean);
        if(![...watermarkFile.control.options].some((o)=>o.value===clean)){const o=document.createElement("option");o.value=clean;o.textContent=clean;watermarkFile.control.appendChild(o);}
        const wm=findNode(WATERMARK_NODE);const wmWidget=widget(wm,"watermark_file");const wmValues=wmWidget?.options?.values;if(Array.isArray(wmValues)&&!wmValues.includes(clean))wmValues.push(clean);
    };
    // The workflow carries this value through a real graph link. The mirror is
    // retained only for compatibility with older workflow copies.
    const syncWatermarkFile=()=>{const selected=String(value(node,"watermark_file","Velvet_Vice_Watermark.png")||"Velvet_Vice_Watermark.png");ensureWatermarkOption(selected);watermarkFile.control.value=selected;const wm=findNode(WATERMARK_NODE);if(wm)setValue(wm,"watermark_file",selected,false);};
    const updateWatermarkState=()=>{
        const enabled=!!value(node,"watermark",false);const file=String(value(node,"watermark_file","Velvet_Vice_Watermark.png")||"Velvet_Vice_Watermark.png");const pos=String(value(node,"watermark_position","bottom-right")||"bottom-right");
        watermarkState.textContent=enabled?`ON · ${file} · ${pos}`:"OFF · final image passes through unchanged";
        watermarkState.classList.toggle("on",enabled);watermarkSec.classList.toggle("is-enabled",enabled);
    };

    watermarkFile.control.addEventListener("change",()=>{syncWatermarkFile();updateWatermarkState();});
    watermarkToggle.control.addEventListener("change",()=>{if(watermarkToggle.control.checked)watermarkDetails.open=true;updateWatermarkState();});
    watermarkDetails.addEventListener("toggle",()=>node.setDirtyCanvas?.(true,true));
    uploadButton.addEventListener("click",()=>fileInput.click());
    fileInput.addEventListener("change",async()=>{
        const file=fileInput.files?.[0];if(!file)return;uploadButton.disabled=true;uploadButton.textContent="UPLOAD…";
        try{
            const form=new FormData();form.append("image",file);form.append("type","input");form.append("overwrite","true");
            const response=await api.fetchApi("/upload/image",{method:"POST",body:form});if(!response.ok)throw new Error(`Upload failed (${response.status})`);
            const data=await response.json();const name=[data?.subfolder,data?.name].filter(Boolean).join("/")||file.name;ensureWatermarkOption(name);setValue(node,"watermark_file",name);syncWatermarkFile();updateWatermarkState();watermarkDetails.open=true;
        }catch(error){watermarkState.textContent=`UPLOAD ERROR · ${error?.message??error}`;watermarkState.classList.remove("on");}
        finally{uploadButton.disabled=false;uploadButton.textContent="UPLOAD";fileInput.value="";}
    });

    const commitProject=()=>{setValue(node,"project_name",projectInput.value);syncProject();};
    projectInput.addEventListener("input",commitProject); projectInput.addEventListener("change",commitProject);
    const syncControls=()=>{for(const ctl of controls)ctl.sync?.(); projectInput.value=value(node,"project_name","");syncProject();syncWatermarkFile();updateWatermarkState();};
    node.__vvh3SyncControls=syncControls;

    // Keep H3 output/finishing choices outside the workflow JSON, exactly like
    // the H3 System Hub and Director. This prevents workflow tab switches from
    // recreating the custom DOM surface with stale/default hidden widget values.
    let restoring=true;
    let saveTimer=null;
    const outputPayload=()=>captureNode(node,CAPTURE[OUTPUT_HUB]);
    const saveNow=async()=>{
        if(restoring)return;
        try{await requestJson("/velvet_vice/h3/state/output_hub",{payload:outputPayload()});}
        catch(e){console.warn("[VELVET VICE] H3 Output Hub persistence save failed",e);}
    };
    const scheduleSave=()=>{if(restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,180);};
    node.__vvh3Persist=scheduleSave;
    node.__vvh3OutputCleanup=()=>{clearTimeout(saveTimer);void saveNow();};
    shell.addEventListener("input",scheduleSave);
    shell.addEventListener("change",scheduleSave);

    async function restoreOutputState(){
        try{
            const response=await requestJson("/velvet_vice/h3/state/output_hub");
            const stored=response?.state?.payload??{};
            for(const [name,persisted] of Object.entries(stored)){
                const w=widget(node,name);if(!w)continue;
                const values=Array.isArray(w?.options?.values)?w.options.values.map(String):null;
                if(values&&!values.includes(String(persisted))){if(name==="watermark_file")ensureWatermarkOption(persisted);else continue;}
                setValue(node,name,persisted,false);
            }
            syncControls();
        }catch(e){
            console.warn("[VELVET VICE] H3 Output Hub persistence restore failed",e);
        }finally{restoring=false;}
    }
    restoreOutputState();
    updateWatermarkState();
    addDom(node,"vvh3_output_surface",shell,625); ensureMinimumNodeSize(node,700,700);
}

const CAPTURE = {
    [SYSTEM]: ["model_backend","auto_preference","native_model","gguf_model","text_encoder","video_vae","audio_vae","turbo_lora","turbo_model_strength","base_steps","turbo_steps","strict_turbo_compatibility","turbo_bypass_on_missing","native_weight_dtype","text_encoder_device","fallback_if_missing","unload_on_backend_change"],
    [DIRECTOR]: ["render_preset","duration_seconds","format_mode","resolution_mode","resolution_preset","rotate_format","custom_width","custom_height","custom_megapixels","turbo_enabled","seed_mode","seed","native_audio_output","ending_mode","fps"],
    [POWER_LORA]: ["lora_stack_json"],
    [TURBO]: ["turbo_lora_name","model_strength","base_steps","turbo_steps","strict_h3_compatibility","bypass_on_missing"],
    [OUTPUT_HUB]: ["live_preview","preview_fps","preview_quality","preview_max_size","rife_48_fps","anti_ghost","watermark","watermark_file","project_name","watermark_position","watermark_scale","watermark_opacity","watermark_margin_x","watermark_margin_y"],
    [OUTPUT_STUDIO]: ["loop_count","filename_prefix","encoder_mode","nvenc_bitrate_mbps_at_24fps","cpu_crf","pix_fmt","pingpong","save_metadata","trim_to_audio","save_output"],
};
function findNode(type){ return (app.graph?._nodes ?? []).find((n)=>typeOf(n)===type); }
function captureNode(node,names){ const out={}; if(!node)return out; for(const name of names){const w=widget(node,name);if(w)out[name]=w.value;} return out; }
function captureProfile(scope){
    if(scope==="lora") return { nodes:{ [POWER_LORA]:captureNode(findNode(POWER_LORA),CAPTURE[POWER_LORA]) } };
    const nodes={}; for(const [type,names] of Object.entries(CAPTURE)) nodes[type]=captureNode(findNode(type),names); return { nodes };
}
function applyProfile(payload){
    const nodes=payload?.nodes ?? {};
    for(const [type,values] of Object.entries(nodes)){
        const node=findNode(type); if(!node||!values)continue;
        for(const [name,v] of Object.entries(values)) setValue(node,name,v);
        node.__vvh3SyncControls?.();
        node.__vvh3Persist?.();
    }
}
function canonical(data){ try{return JSON.stringify(data,Object.keys(data ?? {}).sort());}catch{return JSON.stringify(data ?? {});} }
async function requestJson(url, body=null){ const opts=body==null?{method:"GET"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}; const r=await api.fetchApi(url,opts); const j=await r.json(); if(!j.ok)throw new Error(j.error||"Profile operation failed"); return j; }

function installProfile(node) {
    if(node.__vvh3ProfileInstalled)return; node.__vvh3ProfileInstalled=true; hideNative(node); node.__vvSuppressCanvasChromeV1115=true;
    const shell=document.createElement("div");shell.className="vvh3-shell vvh3-themed-shell";shell.dataset.h3Role="setup";node.__vvh3Shell=shell;
    const head=document.createElement("div");head.className="vvh3-head";head.innerHTML=`<div class="vvh3-title">H3 PROFILE MANAGER</div><div class="vvh3-version">USER DATA · PERSISTENT</div>`;shell.appendChild(head);
    const sec=section("Profiles"); const row=document.createElement("div");row.className="vvh3-profile-row";
    const profileSelect=document.createElement("select");profileSelect.className="vvh3-profile-name";
    const nameInput=document.createElement("input");nameInput.className="vvh3-profile-name";nameInput.placeholder="New profile name"; row.append(profileSelect,nameInput);sec.appendChild(row);
    const scopeWrap=selectControl(node,"profile_scope","Scope",()=>refreshList());sec.appendChild(grid(scopeWrap));
    const modified=document.createElement("div");modified.className="vvh3-modified";modified.textContent="NO PROFILE LOADED";sec.appendChild(modified);
    const actions=document.createElement("div");actions.className="vvh3-actions";
    function button(text,fn,cls=""){const b=document.createElement("button");b.type="button";b.className=`vvh3-button ${cls}`;b.textContent=text;b.onclick=()=>fn().catch((e)=>{status.textContent=`ERROR · ${e.message}`;status.className="vvh3-status bad";});actions.appendChild(b);return b;}
    let loadedName="";let loadedSnapshot="";
    const scope=()=>String(value(node,"profile_scope","FULL H3")).startsWith("LORA")?"lora":"h3";
    async function refreshList(selectName=null){const j=await requestJson(`/velvet_vice/h3/profiles?scope=${encodeURIComponent(scope())}`);profileSelect.innerHTML="";const empty=document.createElement("option");empty.value="";empty.textContent="— select profile —";profileSelect.appendChild(empty);for(const p of j.profiles){const o=document.createElement("option");o.value=p.name;o.textContent=p.name;profileSelect.appendChild(o);}if(selectName)profileSelect.value=selectName;}
    async function load(){const name=profileSelect.value;if(!name)throw new Error("Select a profile first");const j=await requestJson("/velvet_vice/h3/profiles/load",{scope:scope(),name});applyProfile(j.profile.payload);loadedName=name;loadedSnapshot=JSON.stringify(captureProfile(scope()));setValue(node,"active_profile",name,false);setValue(node,"profile_payload",loadedSnapshot,false);nameInput.value=name;status.textContent=`LOADED · ${name}`;status.className="vvh3-status";updateDirty();}
    async function save(nameOverride=null){const name=(nameOverride||loadedName||nameInput.value||profileSelect.value).trim();if(!name)throw new Error("Enter a profile name");const payload=captureProfile(scope());await requestJson("/velvet_vice/h3/profiles/save",{scope:scope(),name,payload});loadedName=name;loadedSnapshot=JSON.stringify(payload);setValue(node,"active_profile",name,false);setValue(node,"profile_payload",loadedSnapshot,false);await refreshList(name);nameInput.value=name;status.textContent=`SAVED · ${name}`;status.className="vvh3-status";updateDirty();}
    async function saveAs(){const name=prompt("Save profile as:",nameInput.value||loadedName||"");if(name)await save(name);}
    async function rename(){if(!loadedName)throw new Error("Load a profile first");const next=prompt("Rename profile:",loadedName);if(!next||next===loadedName)return;await requestJson("/velvet_vice/h3/profiles/rename",{scope:scope(),old_name:loadedName,new_name:next});loadedName=next;nameInput.value=next;setValue(node,"active_profile",next,false);await refreshList(next);status.textContent=`RENAMED · ${next}`;}
    async function duplicate(){const next=prompt("Duplicate profile as:",`${loadedName||"Profile"} Copy`);if(next)await save(next);}
    async function del(){const name=loadedName||profileSelect.value;if(!name)throw new Error("Select a profile first");if(!confirm(`Delete profile “${name}”?`))return;await requestJson("/velvet_vice/h3/profiles/delete",{scope:scope(),name});loadedName="";loadedSnapshot="";nameInput.value="";setValue(node,"active_profile","",false);await refreshList();status.textContent=`DELETED · ${name}`;updateDirty();}
    async function exportP(){const name=loadedName||profileSelect.value;if(!name)throw new Error("Select a profile first");const j=await requestJson("/velvet_vice/h3/profiles/export",{scope:scope(),name});const blob=new Blob([JSON.stringify(j.profile,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`VelvetVice_${scope()}_${name.replace(/[^a-z0-9_-]+/gi,"_")}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
    const file=document.createElement("input");file.type="file";file.accept="application/json";file.style.display="none";file.onchange=async()=>{const f=file.files?.[0];if(!f)return;const doc=JSON.parse(await f.text());const j=await requestJson("/velvet_vice/h3/profiles/import",{scope:scope(),document:doc});await refreshList(j.profile.name);loadedName=j.profile.name;loadedSnapshot=JSON.stringify(j.profile.payload);status.textContent=`IMPORTED · ${loadedName}`;updateDirty();};shell.appendChild(file);
    button("LOAD",load);button("SAVE",()=>save());button("SAVE AS",saveAs);button("RENAME",rename);button("DUPLICATE",duplicate);button("DELETE",del,"danger");button("IMPORT",async()=>file.click());button("EXPORT",exportP);sec.appendChild(actions);shell.appendChild(sec);
    const status=statusBox("Profiles are stored outside the custom-node folder");shell.appendChild(status);
    profileSelect.addEventListener("change",()=>{nameInput.value=profileSelect.value;});
    function updateDirty(){if(!loadedName){modified.textContent="NO PROFILE LOADED";modified.className="vvh3-modified";return;}const current=JSON.stringify(captureProfile(scope()));const dirty=current!==loadedSnapshot;modified.textContent=`${loadedName} · ${dirty?"MODIFIED":"SAVED"}`;modified.className=`vvh3-modified ${dirty?"dirty":"clean"}`;}
    node.__vvh3ProfileTimer=setInterval(updateDirty,1000);node.__vvh3ProfileCleanup=()=>clearInterval(node.__vvh3ProfileTimer);
    refreshList().catch(()=>{});addDom(node,"vvh3_profile_surface",shell,390);ensureMinimumNodeSize(node,690,450);
}

function install(node){installStyles();const type=typeOf(node);if(type===SYSTEM)installSystemHub(node);else if(type===DIRECTOR)installDirector(node);else if(type===PROFILE)installProfile(node);else if(type===OUTPUT_HUB)installOutputHub(node);}
function reassert(){for(const n of app.graph?._nodes??[])install(n);}
app.registerExtension({
    name:"VelvetVice.MiniMaxH3.WorkspaceV140",
    nodeCreated(node){install(node);},
    loadedGraphNode(node){install(node);},
    afterConfigureGraph(){reassert();setTimeout(reassert,250);setTimeout(reassert,1200);},
    nodeRemoved(node){h3DirectorSurfaces.delete(String(node?.id));node.__vvh3ProfileCleanup?.();node.__vvh3SystemCleanup?.();node.__vvh3DirectorCleanup?.();node.__vvh3OutputCleanup?.();},
});
