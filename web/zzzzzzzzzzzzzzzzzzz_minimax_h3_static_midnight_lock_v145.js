import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const FIXED = Object.freeze({
  setup:{title:"#4b216f",body:"#0b1722",box:"#7652a6"},
  source:{title:"#263f6d",body:"#0b1722",box:"#4f78ad"},
  prompt:{title:"#43236d",body:"#0b1722",box:"#7552a6"},
  model:{title:"#3d2766",body:"#0b1722",box:"#6d55a2"},
  video:{title:"#243f70",body:"#0b1722",box:"#4c72ad"},
  preview:{title:"#29466f",body:"#0b1722",box:"#557cad"},
  post:{title:"#334066",body:"#0b1722",box:"#5d6fa4"},
  output:{title:"#412568",body:"#0b1722",box:"#7655a3"},
  guide:{title:"#303747",body:"#0d1720",box:"#586174"},
  internal:{title:"#242d3a",body:"#09121a",box:"#435064"},
});
function typeOf(n){return String(n?.comfyClass??n?.type??"");}
function titleOf(n){return String(n?.title??"");}
function isZen(n){const p=n?.properties??{};return typeOf(n).startsWith("VelvetViceZenMiniMaxH3")||p.vv_zen_h3_scope===true||String(p.vv_closed_system??"").startsWith("ZEN_H3");}
function isH3(n){return !!n&&!isZen(n)&&(typeOf(n).startsWith("VelvetViceMiniMaxH3")||Boolean(n?.properties?.vv_design_system)||Boolean(n?.properties?.vv_design));}
function role(n){
  const t=typeOf(n), title=titleOf(n).toUpperCase();
  if(n?.properties?.vv_h3_internal||title.startsWith("H3 INTERNAL"))return "internal";
  if(/NOTE|LABEL|BOOKMARK|REROUTE/.test(t.toUpperCase())||/GUIDE|REQUIREMENTS|DIAGNOSTICS|CONSTRAINTS|DEFAULTS/.test(title))return "guide";
  if(/REFERENCE IMAGE|SOURCE FRAME/.test(title)||t==="LoadImage")return "source";
  if(/PROMPT/.test(t.toUpperCase())||/PROMPT/.test(title)||t.includes("OllamaRelease"))return "prompt";
  if(/LORA|TURBO|MODEL ROUTER|VAE ROUTER/.test(title)||t==="VelvetViceMiniMaxH3PowerLoraAV")return "model";
  if(/LIVE PREVIEW/.test(title)||t==="VelvetViceMiniMaxH3LivePreview")return "preview";
  if(/MINIMAX H3 ENGINE/.test(title)||t==="VelvetViceMiniMaxH3AudioGate")return "video";
  if(/OUTPUT STUDIO|OUTPUT \/ FINISHING HUB/.test(title)||["VelvetViceMiniMaxH3OutputHub","VelvetViceMiniMaxH3OutputStudio"].includes(t))return "output";
  if(/RIFE|GHOST|WATERMARK|ROUTER|CHECKPOINT|PRUNE|CLEANUP/.test(title))return "post";
  return "setup";
}
function shell(n){return n?.__vvh3Shell??n?.__vvH3PromptShell??n?.__vvH3FinalPromptShell??n?.__vvPowerLoraShell??n?.__vvOutputShell??n?.__vvWatermarkShell??n?.__vvH3MonitorShell??n?.__vvh3PreviewDisplay?.shell??null;}
function fixNode(n){
  if(!isH3(n))return;
  const p=FIXED[role(n)]??FIXED.setup;
  n.__vvExecutionState="idle";
  n.color=p.title;n.bgcolor=p.body;n.boxcolor=p.box;
  const s=shell(n);
  if(s){s.classList.add("vvh3-static-midnight","vvh3-static-v145-lock");s.dataset.h3StaticState="idle";s.dataset.h3Role=role(n);}
  n.setDirtyCanvas?.(true,true);
}
function fixGroups(){for(const g of app.graph?._groups??[])g.color="#293342";}
function fixAll(){for(const n of app.graph?._nodes??[])fixNode(n);fixGroups();app.graph?.setDirtyCanvas?.(true,true);}
function fixEvent(detail){
  const raw=detail?.node??detail?.node_id??detail; const id=raw==null?null:Number(String(raw).split(":")[0]);
  if(Number.isFinite(id))fixNode(app.graph?.getNodeById?.(id));
  // Reassert after all other execution listeners as well.
  queueMicrotask(fixAll); setTimeout(fixAll,0); setTimeout(fixAll,25);
}
function css(){
  if(document.getElementById("vvh3-static-v145-lock-css"))return;
  const st=document.createElement("style");st.id="vvh3-static-v145-lock-css";
  st.textContent=`
    .vvh3-static-v145-lock,.vvh3-static-v145-lock *{animation:none!important;transition:none!important}
    .vvh3-static-v145-lock[data-h3-static-state="active"],.vvh3-static-v145-lock[data-h3-static-state="warning"],.vvh3-static-v145-lock[data-h3-static-state="error"]{border-color:rgba(74,104,165,.48)!important;box-shadow:0 10px 26px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.025)!important}
    .vvh3-static-v145-lock .vvh3-head,.vvh3-static-v145-lock .vvh3-preview-head,.vvh3-static-v145-lock .vvh3p-head,.vvh3-static-v145-lock .vv-head,.vvh3-static-v145-lock .vvh3m-head{background:linear-gradient(105deg,#4b216f 0%,#31265f 46%,#24466f 100%)!important;border-bottom-color:rgba(90,105,176,.34)!important;box-shadow:inset 0 -2px 0 rgba(87,84,169,.26)!important}
    .vvh3-static-v145-lock .vvh3-status,.vvh3-static-v145-lock .vvh3m-status[data-tone="ready"],.vvh3-static-v145-lock .vvh3-decoder-status.installed,.vvh3-static-v145-lock .vvh3-refine-section.is-enabled .vvh3-refine-state{background:#101827!important;border-color:rgba(92,104,177,.32)!important;color:#c2c9e5!important}
    .vvh3-static-v145-lock .vvh3-decoder-status.installed .vvh3-decoder-dot{background:#7968b0!important;box-shadow:0 0 10px rgba(121,104,176,.24)!important}
    .vvh3-static-v145-lock .vvh3-refine-section.is-enabled{border-color:rgba(107,91,177,.38)!important;box-shadow:0 0 16px rgba(81,64,145,.10)!important}
  `;
  document.head.appendChild(st);
}
css();
for(const ev of ["execution_start","executing","progress","executed","execution_success","execution_error","execution_interrupted"]){api.addEventListener(ev,({detail}={})=>fixEvent(detail));}
app.registerExtension({
  name:"VelvetVice.MiniMaxH3.StaticMidnightLockV145",
  nodeCreated(n){setTimeout(()=>fixNode(n),0);},
  loadedGraphNode(n){setTimeout(()=>fixNode(n),0);},
  afterConfigureGraph(){setTimeout(fixAll,50);setTimeout(fixAll,250);setTimeout(fixAll,1000);},
});
