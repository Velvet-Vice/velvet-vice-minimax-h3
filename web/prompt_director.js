import { app } from "../../scripts/app.js";

function ensureCss() { window.VelvetViceH3Design?.installCss?.(); } // internal shared style compatibility
function findWidget(node, name) { return node.widgets?.find((widget) => widget.name === name); }
const DIRECTOR_TYPES = new Set([
    "VelvetViceMiniMaxH3PromptDirector",
]);

function hideNativeWidget(widget) {
    if (!widget || widget.__vvH3PromptHidden) return;
    widget.__vvH3PromptHidden = true;
    widget.hidden = true;
    widget.computeSize = () => [0, -4];
}

function installH3PromptCss() {
    if (document.getElementById("vv-h3-prompt-director-css")) return;
    const style = document.createElement("style");
    style.id = "vv-h3-prompt-director-css";
    style.textContent = `
      .vvh3p-shell,.vvh3p-shell *{box-sizing:border-box}
      .vvh3p-shell{width:100%;height:100%;padding:12px;background:linear-gradient(145deg,#141c25,#1b2631);color:#e7e4ea;font-family:Inter,"Segoe UI",Arial,sans-serif;border:1px solid rgba(183,157,208,.18);border-radius:11px;overflow:auto;pointer-events:auto}
      .vvh3p-shell button,.vvh3p-shell input,.vvh3p-shell select,.vvh3p-shell textarea,.vvh3p-shell summary,.vvh3p-shell details{pointer-events:auto}
      .vvh3p-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 2px 11px;border-bottom:1px solid rgba(255,255,255,.06)}
      .vvh3p-title{font-size:12px;font-weight:900;letter-spacing:.08em;color:#f0edf3}.vvh3p-sub{margin-top:3px;font-size:7.5px;color:#84919d;letter-spacing:.07em;text-transform:uppercase}
      .vvh3p-badge{flex:0 0 auto;padding:5px 10px;border:1px solid rgba(167,137,190,.28);border-radius:999px;background:#17141d;color:#bea8d0;font-size:7.5px;font-weight:900;letter-spacing:.08em}
      .vvh3p-section{margin-top:10px;padding:10px;border:1px solid rgba(185,161,207,.12);border-radius:9px;background:#111922}
      .vvh3p-label{display:block;margin-bottom:6px;font-size:7.5px;font-weight:900;letter-spacing:.10em;color:#a890bb;text-transform:uppercase}
      .vvh3p-topgrid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:8px}
      .vvh3p-field{display:flex;flex-direction:column;gap:4px;min-width:0}.vvh3p-field span{font-size:7px;font-weight:850;letter-spacing:.06em;color:#85919d;text-transform:uppercase}
      .vvh3p-field select,.vvh3p-field input{width:100%;min-width:0;height:31px;padding:5px 8px;border:1px solid rgba(190,170,208,.14);border-radius:7px;background:#0d141b;color:#e8e4eb;font-size:9px}
      .vvh3p-editor{display:flex;flex-direction:column;min-height:320px}
      .vvh3p-editor textarea{width:100%;min-height:292px;resize:vertical;padding:11px 12px;border:1px solid rgba(190,170,208,.17);border-radius:8px;background:#0b1117;color:#eeeaf1;font:10.5px/1.48 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}
      .vvh3p-editor textarea:focus{border-color:rgba(168,129,199,.55);box-shadow:0 0 0 2px rgba(119,82,149,.12)}
      .vvh3p-editor-foot{display:flex;justify-content:space-between;gap:10px;margin-top:6px;color:#7f8b97;font-size:7.5px}.vvh3p-editor-foot strong{color:#a9b4bf;font-weight:800}
      .vvh3p-details{margin-top:9px;border:1px solid rgba(184,163,204,.11);border-radius:8px;background:#101820;overflow:hidden}.vvh3p-details summary{padding:9px 10px;cursor:pointer;list-style:none;color:#aeb7c1;font-size:8px;font-weight:900;letter-spacing:.075em;text-transform:uppercase}.vvh3p-details summary::-webkit-details-marker{display:none}.vvh3p-details[open] summary{border-bottom:1px solid rgba(255,255,255,.06);color:#c6b4d5}
      .vvh3p-advanced-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px}.vvh3p-toggle{display:flex;align-items:center;gap:7px;min-height:31px;padding:0 9px;border:1px solid rgba(190,170,208,.12);border-radius:7px;background:#0d141b;color:#c4cbd2;font-size:8.5px}.vvh3p-toggle input{accent-color:#8f6cab}
      .vvh3p-readonly{padding:9px;border-radius:7px;background:#0d141b;color:#909ca7;font-size:8px;line-height:1.45}.vvh3p-readonly b{color:#d8d2de}
      .vvh3p-final-wrap{padding:10px}.vvh3p-final-status{margin-bottom:7px;color:#8f9ba7;font-size:8px;line-height:1.4}.vvh3p-final{width:100%;min-height:180px;resize:vertical;padding:10px;border:1px solid rgba(190,170,208,.15);border-radius:8px;background:#0a1016;color:#e9e5eb;font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
      .vvh3p-actions{display:flex;justify-content:flex-end;margin-top:7px}.vvh3p-button{height:29px;padding:0 12px;border:1px solid rgba(190,170,208,.18);border-radius:7px;background:#273341;color:#e4e0e7;font-size:8px;font-weight:900;cursor:pointer}.vvh3p-button:hover{background:#344354}
      @media(max-width:680px){.vvh3p-topgrid,.vvh3p-advanced-grid{grid-template-columns:1fr}.vvh3p-editor textarea{min-height:260px}}
    `;
    document.head.appendChild(style);
}

function installH3PromptDirector(node) {
    if (node.__vvH3PromptSurfaceInstalled) return;
    node.__vvH3PromptSurfaceInstalled = true;
    installH3PromptCss();

    const relevantNames = [
        "mode", "manual_prompt", "short_idea", "full_auto_settings", "adult_confirmed",
        "ollama_model", "ollama_url", "ollama_context_profile", "ending_mode", "prompt_profile",
    ];
    for (const name of relevantNames) hideNativeWidget(findWidget(node, name));

    const shell = document.createElement("div");
    shell.className = "vvh3p-shell vv-h3-prompt-surface";
    shell.dataset.h3Role = "prompt";
    node.__vvH3PromptShell = shell;

    const head = document.createElement("div");
    head.className = "vvh3p-head";
    const headText = document.createElement("div");
    const title = document.createElement("div"); title.className = "vvh3p-title"; title.textContent = "VELVET VICE · H3 VISION / PROMPT DIRECTOR";
    const sub = document.createElement("div"); sub.className = "vvh3p-sub"; sub.textContent = "Native H3 I2VA · first-frame anchored · audio-aware";
    headText.append(title, sub);
    const badge = document.createElement("div"); badge.className = "vvh3p-badge"; badge.textContent = "READY";
    head.append(headText, badge); shell.appendChild(head);

    const modeSection = document.createElement("div"); modeSection.className = "vvh3p-section";
    const topgrid = document.createElement("div"); topgrid.className = "vvh3p-topgrid";
    const makeSelect = (name, label) => {
        const native = findWidget(node, name);
        const field = document.createElement("label"); field.className = "vvh3p-field";
        const cap = document.createElement("span"); cap.textContent = label;
        const select = document.createElement("select");
        const values = Array.isArray(native?.options?.values) ? native.options.values : [native?.value ?? ""];
        for (const item of values) { const option = document.createElement("option"); option.value = String(item); option.textContent = String(item); select.appendChild(option); }
        select.value = String(native?.value ?? "");
        select.addEventListener("change", () => { if (!native) return; native.value = select.value; native.callback?.(select.value); node.setDirtyCanvas?.(true,true); refreshMode(); });
        field.append(cap, select);
        return { field, select, native };
    };
    const modeCtl = makeSelect("mode", "Mode");
    topgrid.appendChild(modeCtl.field);
    const owner = document.createElement("div"); owner.className = "vvh3p-readonly"; owner.innerHTML = `<b>ENDING MODE</b><br>Controlled by MiniMax H3 Director`;
    topgrid.appendChild(owner); modeSection.appendChild(topgrid); shell.appendChild(modeSection);

    const editorSection = document.createElement("div"); editorSection.className = "vvh3p-section vvh3p-editor";
    const editorLabel = document.createElement("div"); editorLabel.className = "vvh3p-label";
    const editor = document.createElement("textarea"); editor.spellcheck = true;
    const editorFoot = document.createElement("div"); editorFoot.className = "vvh3p-editor-foot";
    const editorHint = document.createElement("span");
    const count = document.createElement("strong");
    editorFoot.append(editorHint, count); editorSection.append(editorLabel, editor, editorFoot); shell.appendChild(editorSection);

    let activePromptWidget = null;
    function modePromptWidget(mode) {
        if (mode === "MANUAL") return { name: "manual_prompt", label: "FINAL MANUAL PROMPT", hint: "Passed to H3 unchanged · no Ollama call" };
        if (mode === "ADULT FULL AUTO") return { name: "full_auto_settings", label: "FULL AUTO SCENE / MOTION INSTRUCTIONS", hint: "Autonomous H3 I2VA analysis, choreography and continuity validation" };
        return { name: "short_idea", label: "SCENE / MOTION PROMPT", hint: mode === "STANDARD VISION" ? "Vision expands this into H3's native timed audiovisual structure" : "Assisted H3 I2VA direction with four-stage validation" };
    }
    function updateCount() {
        const text = editor.value ?? "";
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        count.textContent = `${text.length} chars · ${words} words`;
    }
    function commitEditor() {
        if (!activePromptWidget) return;
        activePromptWidget.value = editor.value;
        activePromptWidget.callback?.(editor.value);
        updateCount(); node.setDirtyCanvas?.(true,true);
    }
    editor.addEventListener("input", commitEditor);
    function refreshMode() {
        const mode = String(findWidget(node,"mode")?.value ?? "MANUAL");
        modeCtl.select.value = mode;
        const binding = modePromptWidget(mode);
        activePromptWidget = findWidget(node, binding.name);
        editorLabel.textContent = binding.label;
        editorHint.textContent = binding.hint;
        editor.value = String(activePromptWidget?.value ?? "");
        updateCount();
        const adult = mode.startsWith("ADULT");
        if (adultGateRow) adultGateRow.style.display = adult ? "flex" : "none";
    }

    const advanced = document.createElement("details"); advanced.className = "vvh3p-details";
    const advancedSummary = document.createElement("summary"); advancedSummary.textContent = "Advanced / Ollama"; advanced.appendChild(advancedSummary);
    const advancedGrid = document.createElement("div"); advancedGrid.className = "vvh3p-advanced-grid";
    const adultNative = findWidget(node,"adult_confirmed");
    const adultGateRow = document.createElement("label"); adultGateRow.className = "vvh3p-toggle";
    const adultCheck = document.createElement("input"); adultCheck.type = "checkbox"; adultCheck.checked = !!adultNative?.value;
    const adultText = document.createElement("span"); adultText.textContent = "Adult mode confirmed";
    adultCheck.addEventListener("change",()=>{ if(adultNative){adultNative.value=adultCheck.checked;adultNative.callback?.(adultCheck.checked);} });
    adultGateRow.append(adultCheck,adultText); advancedGrid.appendChild(adultGateRow);

    const makeTextInput = (name,label) => {
        const native = findWidget(node,name); const field=document.createElement("label"); field.className="vvh3p-field";
        const cap=document.createElement("span"); cap.textContent=label; const input=document.createElement("input"); input.type="text"; input.value=String(native?.value??"");
        input.addEventListener("input",()=>{if(native){native.value=input.value;native.callback?.(input.value);}}); field.append(cap,input); return field;
    };
    advancedGrid.append(makeTextInput("ollama_model","Ollama Model"),makeTextInput("ollama_url","Ollama URL"));
    const contextCtl=makeSelect("ollama_context_profile","Context Profile"); advancedGrid.appendChild(contextCtl.field);
    const promptLogic=document.createElement("div"); promptLogic.className="vvh3p-readonly"; promptLogic.innerHTML=`<b>PROMPT LOGIC</b><br>MiniMax H3 I2VA · structured timeline`;
    advancedGrid.appendChild(promptLogic); advanced.appendChild(advancedGrid); shell.appendChild(advanced);

    const finalDetails = document.createElement("details"); finalDetails.className = "vvh3p-details";
    const finalSummary = document.createElement("summary"); finalSummary.textContent = "Final Prompt Output"; finalDetails.appendChild(finalSummary);
    const finalWrap=document.createElement("div"); finalWrap.className="vvh3p-final-wrap";
    const finalStatus=document.createElement("div"); finalStatus.className="vvh3p-final-status"; finalStatus.textContent="Not executed yet. The generated MiniMax H3 prompt appears here after execution.";
    const finalPrompt=document.createElement("textarea"); finalPrompt.className="vvh3p-final"; finalPrompt.readOnly=true;
    const actions=document.createElement("div"); actions.className="vvh3p-actions";
    const copy=document.createElement("button"); copy.type="button"; copy.className="vvh3p-button"; copy.textContent="COPY FINAL PROMPT"; copy.onclick=async()=>{if(finalPrompt.value)await navigator.clipboard.writeText(finalPrompt.value).catch(()=>{});};
    actions.appendChild(copy); finalWrap.append(finalStatus,finalPrompt,actions); finalDetails.appendChild(finalWrap); shell.appendChild(finalDetails);

    const surface = node.addDOMWidget("vv_h3_prompt_director_surface", "VELVET VICE H3 PROMPT DIRECTOR", shell, {serialize:false,hideOnZoom:false,margin:0});
    surface.serialize=false; surface.serializeValue=()=>undefined;
    const layout={height:650};
    const applyHeight=(h)=>{layout.height=Math.max(610,Math.min(870,Math.ceil(h)));surface.computeSize=(width)=>[width,layout.height];surface.computeLayoutSize=()=>({minHeight:layout.height,maxHeight:Infinity});surface.options??={};surface.options.getMinHeight=()=>layout.height;surface.options.getMaxHeight=()=>Infinity;surface.options.getHeight=()=>layout.height;};
    // Details stay inside the manually sized surface. Never derive a new node
    // height from shell.scrollHeight; that closes the node/widget feedback loop.
    const fit=()=>requestAnimationFrame(()=>{node.setDirtyCanvas?.(true,true);});
    advanced.addEventListener("toggle",fit); finalDetails.addEventListener("toggle",fit); editor.addEventListener("mouseup",fit);
    node.__vvH3PromptFit=fit;
    node.__vvH3PromptFinal=finalPrompt; node.__vvH3PromptStatus=finalStatus; node.__vvH3PromptBadge=badge;
    node.resizable=true;refreshMode();applyHeight(650);const initial=[Math.max(Number(node.size?.[0]??0),840),Math.max(Number(node.size?.[1]??0),720)];node.setSize?.(initial);fit();
}

function installLegacyPromptDirector(node, isMiniMaxH3) {
    ensureCss();
    const fullAutoSettings = findWidget(node, "full_auto_settings");
    if (fullAutoSettings) fullAutoSettings.label = "EDITABLE FULL AUTO DEFAULTS";
    const endingMode = findWidget(node, "ending_mode");
    if (endingMode) endingMode.label = "ENDING MODE — HARD OVERRIDE";
    const promptProfile = findWidget(node, "prompt_profile");
    if (promptProfile) promptProfile.label = "MINIMAX H3 PROMPT LOGIC";

    const shell = document.createElement("div"); shell.className = "vv-shell";
    const head = document.createElement("div"); head.className = "vv-head";
    const brand = document.createElement("div"); brand.className = "vv-brand"; brand.textContent = "VELVET VICE · FINAL PROMPT OUTPUT";
    const badge = document.createElement("div"); badge.className = "vv-badge"; badge.textContent = "READY"; head.append(brand,badge); shell.appendChild(head);
    const body=document.createElement("div"); body.className="vv-body";
    const chips=document.createElement("div"); chips.className="vv-prompt-meta";
    const modeChip=document.createElement("div"); modeChip.className="vv-chip"; const endingChip=document.createElement("div");endingChip.className="vv-chip";const memoryChip=document.createElement("div");memoryChip.className="vv-chip";const profileChip=document.createElement("div");profileChip.className="vv-chip";chips.append(modeChip,profileChip,endingChip,memoryChip);
    const status=document.createElement("div");status.className="vv-status-detail";status.textContent="Not executed yet. Manual mode never contacts Ollama.";
    const prompt=document.createElement("textarea");prompt.className="vv-textarea";prompt.readOnly=true;prompt.placeholder="The validated MiniMax H3 prompt appears here after execution.";prompt.style.minHeight="130px";
    const actions=document.createElement("div");actions.style.display="flex";actions.style.gap="8px";actions.style.marginTop="8px";const copy=document.createElement("button");copy.className="vv-button";copy.textContent="COPY FINAL PROMPT";copy.addEventListener("click",async()=>{if(prompt.value)await navigator.clipboard.writeText(prompt.value).catch(()=>{});});actions.append(copy);body.append(chips,status,prompt,actions);shell.appendChild(body);
    const dom=node.addDOMWidget("vv_director_surface","VELVET VICE DIRECTOR",shell,{serialize:false,hideOnZoom:false});dom.serialize=false;dom.serializeValue=()=>undefined;dom.computeSize=(width)=>[width,278];node.vvDirectorPrompt=prompt;node.vvDirectorStatus=status;node.vvDirectorBadge=badge;
    const refresh=()=>{modeChip.textContent=`MODE · ${findWidget(node,"mode")?.value??"MANUAL"}`;profileChip.textContent=`PROMPT · ${findWidget(node,"prompt_profile")?.value??"MiniMax H3"}`;endingChip.textContent=`ENDING · ${findWidget(node,"ending_mode")?.value??"AUTO"}`;memoryChip.textContent=`OLLAMA · ${findWidget(node,"ollama_context_profile")?.value??"DEFAULT"}`;};
    for(const name of ["mode","prompt_profile","ending_mode","ollama_context_profile"]){const widget=findWidget(node,name);if(!widget)continue;const original=widget.callback;widget.callback=(value)=>{original?.call(widget,value);refresh();};}refresh();node.resizable=true;node.setSize([Math.max(node.size?.[0]??800,800),Math.max(node.size?.[1]??780,780)]);
}

app.registerExtension({
    name: "VelvetVice.MiniMaxH3.PromptDirectorSurfaceV140",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!DIRECTOR_TYPES.has(nodeData.name)) return;
        const isMiniMaxH3 = nodeData.name === "VelvetViceMiniMaxH3PromptDirector";
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            if (isMiniMaxH3) installH3PromptDirector(this);
            else installLegacyPromptDirector(this, false);
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            const prompt = message?.final_prompt?.[0];
            const status = message?.status?.[0];
            if (isMiniMaxH3) {
                if (typeof prompt === "string" && this.__vvH3PromptFinal) this.__vvH3PromptFinal.value = prompt;
                if (typeof status === "string" && this.__vvH3PromptStatus) this.__vvH3PromptStatus.textContent = status;
                if (this.__vvH3PromptBadge) this.__vvH3PromptBadge.textContent = "PROMPT READY";
                this.__vvH3PromptFit?.();
            } else {
                if (typeof prompt === "string" && this.vvDirectorPrompt) this.vvDirectorPrompt.value = prompt;
                if (typeof status === "string" && this.vvDirectorStatus) this.vvDirectorStatus.textContent = status;
                if (this.vvDirectorBadge) this.vvDirectorBadge.textContent = "PROMPT READY";
            }
            this.setDirtyCanvas?.(true, true);
        };
    },
});
