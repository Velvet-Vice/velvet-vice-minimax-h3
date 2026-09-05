import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TYPE = "VelvetViceMiniMaxH3PromptDirector";
const ENDPOINT = "/velvet_vice/h3/state/prompt_director";
const FALLBACK_KEY = "velvetVice.h3.promptDirector.mode.v145";
const MODES = new Set(["MANUAL","STANDARD VISION","ADULT ASSISTED","ADULT FULL AUTO"]);

function typeOf(node){ return String(node?.comfyClass ?? node?.type ?? ""); }
function modeWidget(node){ return node?.widgets?.find((w)=>w?.name==="mode"); }
function valid(mode){ mode=String(mode??"").toUpperCase(); return MODES.has(mode)?mode:null; }
async function requestJson(url,body=null){
  const opts=body==null?{method:"GET"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};
  const r=await api.fetchApi(url,opts); const j=await r.json();
  if(!j?.ok) throw new Error(j?.error||"Prompt state request failed");
  return j;
}
async function saveMode(mode){
  mode=valid(mode); if(!mode)return;
  try{ localStorage.setItem(FALLBACK_KEY,mode); }catch(_){ }
  try{ await requestJson(ENDPOINT,{payload:{mode}}); }
  catch(e){ console.warn("[VELVET VICE] H3 Prompt Director server persistence failed; local fallback retained.",e); }
}
async function loadMode(){
  try{
    const j=await requestJson(ENDPOINT);
    const m=valid(j?.state?.payload?.mode);
    if(m)return m;
  }catch(_){ }
  try{return valid(localStorage.getItem(FALLBACK_KEY));}catch(_){return null;}
}
function visibleModeSelect(node){
  const shell=node?.__vvH3PromptShell;
  if(!shell)return null;
  const selects=[...shell.querySelectorAll("select")];
  return selects.find((s)=>[...s.options].some((o)=>MODES.has(String(o.value).toUpperCase())))??null;
}
function applyMode(node,mode){
  mode=valid(mode); if(!mode)return false;
  const w=modeWidget(node); if(!w)return false;
  const allowed=Array.isArray(w?.options?.values)?w.options.values.map((x)=>String(x).toUpperCase()):[];
  if(allowed.length&&!allowed.includes(mode))return false;
  const sel=visibleModeSelect(node);
  if(sel){
    sel.value=mode;
    sel.dispatchEvent(new Event("change",{bubbles:true}));
  }else{
    w.value=mode; w.callback?.(mode); node.setDirtyCanvas?.(true,true);
  }
  return true;
}
function hook(node){
  if(typeOf(node)!==TYPE||node.__vvPromptPersistV145Hooked)return;
  const attempt=async(retries=0)=>{
    if(node.__vvPromptPersistV145Hooked)return;
    const w=modeWidget(node);
    if(!w){ if(retries<30)setTimeout(()=>attempt(retries+1),75); return; }
    node.__vvPromptPersistV145Hooked=true;
    let restoring=true, timer=null;
    const schedule=()=>{
      if(restoring)return;
      clearTimeout(timer);
      timer=setTimeout(()=>void saveMode(w.value),100);
    };
    const original=w.callback;
    w.callback=function(value){ const r=original?.apply(this,arguments); schedule(); return r; };
    const waitForSurface=()=>new Promise((resolve)=>{
      let n=0;
      const tick=()=>{
        const s=visibleModeSelect(node);
        if(s||n++>30)resolve(s);
        else setTimeout(tick,75);
      };
      tick();
    });
    const sel=await waitForSurface();
    sel?.addEventListener("change",schedule);
    const stored=await loadMode();
    if(stored)applyMode(node,stored);
    restoring=false;
    node.__vvPromptPersistV145Save=()=>void saveMode(modeWidget(node)?.value);
  };
  void attempt();
}
function scan(){ for(const n of app.graph?._nodes??[])hook(n); }

app.registerExtension({
  name:"VelvetVice.MiniMaxH3.PromptDirectorPersistenceV145",
  nodeCreated(node){setTimeout(()=>hook(node),0);},
  loadedGraphNode(node){setTimeout(()=>hook(node),0);},
  afterConfigureGraph(){setTimeout(scan,100);setTimeout(scan,500);},
  nodeRemoved(node){node.__vvPromptPersistV145Save?.();},
});
