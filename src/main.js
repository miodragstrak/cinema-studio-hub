import "./styles.css";
import { createLocalStore, readLocalSnapshot, clearLocalSnapshot } from "./store/local.js";
import { createSupabaseStore } from "./store/supabase.js";

/* ---------- constants ---------- */
const STAGES = ["Booked","Scheduled","Shot","In edit","QC","Client review","Revision","Delivered","Archived"];
const REVIEW_INDEX = STAGES.indexOf("Client review");
const TYPES = ["Real estate","Commercial","Event"];
const PACKAGES = ["Photo","Photo + video","Photo + video + drone","Video only","Custom"];
const QC = [
  ["stab","Footage stabilized","No shaky handheld moments or visible warping from over-stabilizing."],
  ["broll","B-roll placed with intent","B-roll covers cuts and jump points and matches what's being said or shown."],
  ["interview","Interviews clean","Framing consistent, audio clear and levelled, no dead air at the start or end."],
  ["brand","Branding correct","Studio intro/outro in place; brokerage logo and licensed name shown on real estate pieces."],
  ["color","Color grade consistent","Shots match across rooms and cameras; whites are neutral, windows not blown out."],
  ["music","Music licensed","Tracks come from the Artlist library and the license covers this client."],
  ["export","Exports match the order","Every ordered format and aspect ratio (16:9, 9:16, 1:1) is exported and named."],
];
const VARIANTS = [["dark","Dark logo"],["light","Light / reversed"],["horiz","Horizontal"],["stacked","Stacked / square"]];
const SUBFOLDERS = ["01_Raw","02_Selects","03_Project","04_Exports","05_Delivered","_Brand"];
const DEFAULT_SETTINGS = {
  dropboxRoot:"/#Cinema Studios", clickupUrl:"", ghlLocation:"uP15oHnQhnPefyoobZNV",
  ghlBase:"https://app.gohighlevel.com", makeUrl:"", turnaroundDays:2, editors:""
};

/* ---------- state ---------- */
const S = {
  jobs:{}, brokerages:{}, settings:{...DEFAULT_SETTINGS},
  view:"today", openJob:null, draft:null, filter:{q:"",type:"",stage:"",archived:false},
  mode:"local", auth:"pending", readOnly:false, localCarry:null
};

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayISO = () => isoDay(new Date());
const addDays = (iso,n) => { const d = new Date(iso+"T12:00:00"); d.setDate(d.getDate()+n); return isoDay(d); };
const fmtDay = iso => iso ? new Date(iso+"T12:00:00").toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"}) : "—";
const fmtTime = t => { if(!t) return "TBC"; const [h,m]=t.split(":").map(Number); const d=new Date(); d.setHours(h,m); return d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}); };
const slug = s => String(s||"").trim().replace(/[\\/:*?"<>|#%]+/g,"").replace(/\s+/g,"-").replace(/-+/g,"-").slice(0,60) || "untitled";
const safeName = s => String(s||"").trim().replace(/[\\/:*?"<>|]+/g,"").slice(0,60) || "Unassigned";
const uid = () => Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4);
const newJobNo = () => { const d=new Date(); return `HC-${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2,5).toUpperCase()}`; };
const editors = () => S.settings.editors.split("\n").map(s=>s.trim()).filter(Boolean);
const jobsArr = () => Object.values(S.jobs);
const brokerageOf = j => j.brokerageId ? S.brokerages[j.brokerageId] : null;
const logoReady = b => b && VARIANTS.every(([k]) => b.variants?.[k]);
const qcDone = j => QC.every(([k]) => j.qc?.[k]);
const handoffCount = j => ["dropbox","clickup","ghl"].filter(k => j.handoff?.[k]?.done).length;

function toast(msg){
  const h=$("#toastHost"); h.innerHTML=`<div class="toast">${esc(msg)}</div>`;
  clearTimeout(toast.t); toast.t=setTimeout(()=>h.innerHTML="",2600);
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast("Copied"); return; }catch(e){}
  const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok=document.execCommand("copy"); }catch(e){}
  ta.remove(); toast(ok ? "Copied" : "Copy blocked — select the text and copy it manually");
}

/* ---------- derived handoff content ---------- */
function dropboxPath(j){
  const root = (S.settings.dropboxRoot||"").replace(/\/+$/,"");
  const b = brokerageOf(j);
  const group = j.type==="Real estate" ? `Real Estate/${safeName(b?.name || "No brokerage")}` : `${j.type==="Event"?"Events":"Commercial"}/${safeName(j.client)}`;
  return `${root}/${group}/${j.shootDate||"no-date"}_${slug(j.address)}_${j.jobNo}`;
}
function dropboxBlock(j){
  const p = dropboxPath(j), b = brokerageOf(j);
  let s = `${p}/\n` + SUBFOLDERS.map(f=>`  ${f}/`).join("\n");
  if(j.type==="Real estate") s += `\n\nLogo pack to copy into _Brand:\n${(S.settings.dropboxRoot||"").replace(/\/+$/,"")}/Brand Assets/Brokerages/${safeName(b?.name||"(pick a brokerage)")}/`;
  return s;
}
function clickupTitle(j){ return `${j.jobNo} | ${j.address||"No address"} | ${j.package||j.type}`; }
function clickupBody(j){
  const b = brokerageOf(j);
  const lines = [
    `Client: ${j.client||"—"}${j.email?` (${j.email})`:""}${j.phone?` ${j.phone}`:""}`,
    j.type==="Real estate" ? `Brokerage: ${b?.name||"—"}` : `Job type: ${j.type}`,
    `Package: ${j.package||"—"}`,
    `Shoot: ${fmtDay(j.shootDate)} at ${fmtTime(j.shootTime)}`,
    `Delivery due: ${fmtDay(j.dueDate)}`,
    `Editor: ${j.editor||"Unassigned"}`,
    `Dropbox: ${j.handoff?.dropbox?.link || dropboxPath(j)}`,
  ];
  if(j.notes) lines.push("", `Notes: ${j.notes}`);
  lines.push("", "QC before client review:", ...QC.map(([,t])=>`- [ ] ${t}`));
  return lines.join("\n");
}
function ghlBlock(j){
  const b = brokerageOf(j);
  return [
    `Contact: ${j.client||"—"}${j.email?` <${j.email}>`:""}${j.phone?` ${j.phone}`:""}`,
    `Opportunity: ${j.address||"No address"} (${j.jobNo})`,
    `Pipeline stage: ${j.stage}`,
    ``,
    `Custom fields`,
    `  Project ID: ${j.jobNo}`,
    `  Job type: ${j.type}`,
    `  Package: ${j.package||"—"}`,
    `  Brokerage: ${j.type==="Real estate" ? (b?.name||"—") : "n/a"}`,
    `  Shoot date: ${j.shootDate||"—"}`,
    `  Delivery due: ${j.dueDate||"—"}`,
    `  Editor: ${j.editor||"—"}`,
    `  Dropbox link: ${j.handoff?.dropbox?.link||"(add after folder is created)"}`,
    `  ClickUp task: ${j.handoff?.clickup?.link||"(add after task is created)"}`,
  ].join("\n");
}
function makePayload(j){
  const b = brokerageOf(j);
  return JSON.stringify({
    event:"job.upsert", job_no:j.jobNo, stage:j.stage, type:j.type, package:j.package,
    client:{name:j.client, email:j.email, phone:j.phone},
    brokerage: j.type==="Real estate" ? {name:b?.name||null, logo_pack_complete:logoReady(b)} : null,
    property:{address:j.address, city:j.city},
    schedule:{shoot_date:j.shootDate, call_time:j.shootTime, due_date:j.dueDate},
    editor:j.editor, dropbox_path:dropboxPath(j),
    links:{dropbox:j.handoff?.dropbox?.link||null, clickup:j.handoff?.clickup?.link||null, ghl:j.handoff?.ghl?.link||null},
    qc_complete:qcDone(j), ghl_location_id:S.settings.ghlLocation
  }, null, 2);
}
function dropboxOpenUrl(j){ return "https://www.dropbox.com/home" + encodeURI(dropboxPath(j)).replace(/#/g,"%23"); }
function ghlOpenUrl(){ return `${(S.settings.ghlBase||"").replace(/\/+$/,"")}/v2/location/${encodeURIComponent(S.settings.ghlLocation||"")}/opportunities/list`; }

/* ---------- attention ---------- */
function attentionItems(){
  const t = todayISO(), out=[];
  for(const j of jobsArr()){
    if(j.stage==="Archived") continue;
    const idx = STAGES.indexOf(j.stage);
    if(j.dueDate && j.dueDate < t && idx < STAGES.indexOf("Delivered")) out.push({j,level:"red",why:`Delivery was due ${fmtDay(j.dueDate)}`});
    if(handoffCount(j) < 3 && idx <= STAGES.indexOf("Shot")) out.push({j,level:"amber",why:`Handoff ${handoffCount(j)}/3 — ${["dropbox","clickup","ghl"].filter(k=>!j.handoff?.[k]?.done).map(k=>({dropbox:"Dropbox folder",clickup:"ClickUp task",ghl:"GHL opportunity"})[k]).join(", ")} not set up`});
    if(j.type==="Real estate" && !logoReady(brokerageOf(j)) && idx < STAGES.indexOf("Delivered")) out.push({j,level:"amber",why: brokerageOf(j) ? `${brokerageOf(j).name} logo pack is incomplete` : "No brokerage picked"});
    if(j.stage==="QC") out.push({j,level:"blue",why:"Waiting on QC sign-off"});
    if(!j.editor && idx>=STAGES.indexOf("Shot") && idx<STAGES.indexOf("Delivered")) out.push({j,level:"amber",why:"No editor assigned"});
  }
  const rank={red:0,amber:1,blue:2};
  return out.sort((a,b)=>rank[a.level]-rank[b.level]);
}

/* ---------- views ---------- */
function render(){
  document.querySelectorAll(".nav button").forEach(b=>b.setAttribute("aria-current", b.dataset.view===S.view ? "page":"false"));
  const n = attentionItems().filter(a=>a.level!=="blue").length, c=$("#attnCount");
  c.hidden = !n; c.textContent = n;
  const note = $("#storageNote");
  note.innerHTML = S.mode==="cloud"
    ? `<b><span class="tally ${S.auth==="in"?"live":"off"}" style="width:8px;height:8px"></span>Shared workspace</b>${S.auth==="in"?`Changes save for everyone on the team.<br><button class="btn sm" style="margin-top:8px" data-act="signout">Sign out</button>`:"Sign in to see the team's jobs."}`
    : `<b><span class="tally off" style="width:8px;height:8px"></span>This device only</b>Jobs save in this browser. Connect Supabase to share them with the team.`;
  const m = $("#main");
  if(S.auth!=="in"){ m.innerHTML = S.auth==="needs-login" ? viewLogin() : `<p class="muted">Loading…</p>`; $("#overlay").innerHTML=""; return; }
  m.innerHTML = ({today:viewToday, jobs:viewJobs, brokerages:viewBrokerages, standards:viewStandards, connections:viewConnections})[S.view]();
  renderOverlay();
}

function viewToday(){
  const t=todayISO(), tm=addDays(t,1);
  const shoots = jobsArr().filter(j=>j.shootDate===t && j.stage!=="Archived").sort((a,b)=>(a.shootTime||"99").localeCompare(b.shootTime||"99"));
  const tomorrow = jobsArr().filter(j=>j.shootDate===tm && j.stage!=="Archived");
  const attn = attentionItems();
  const counts = STAGES.slice(0,8).map(s=>[s, jobsArr().filter(j=>j.stage===s).length]);
  const dateLine = new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
  return `
  <div class="today-head">
    <div><h1>${esc(dateLine)}</h1>
    <p class="sub">${shoots.length ? `${shoots.length} shoot${shoots.length>1?"s":""} on today's call sheet` : "Nothing on today's call sheet"}${tomorrow.length?`, ${tomorrow.length} tomorrow`:""}.</p></div>
  </div>
  ${S.localCarry ? `<div class="banner info row"><span>${S.localCarry.n} job${S.localCarry.n>1?"s":""} saved on this device aren't in the shared workspace yet.</span><span class="spacer"></span><button class="btn sm" data-act="carry">Move them to the shared workspace</button></div>`:""}
  <div class="today-grid">
    <section class="panel" aria-labelledby="csh">
      <div class="row" style="margin-bottom:6px"><span class="tally ${shoots.length?"live":"off"}"></span><h2 id="csh" style="margin:0">Call sheet</h2></div>
      ${shoots.length ? `<ul class="callsheet">${shoots.map(j=>`
        <li><div class="calltime">${esc(fmtTime(j.shootTime))}<small>${esc(j.stage)}</small></div>
        <div><button class="linkish addr" data-open="${esc(j.id)}">${esc(j.address||"No address")}</button>
          <div class="small muted">${esc(j.client||"—")}${j.type==="Real estate"&&brokerageOf(j)?` with ${esc(brokerageOf(j).name)}`:""} | ${esc(j.package||j.type)}</div></div>
        <div class="chips" style="margin:0">${j.editor?`<span class="chip">${esc(j.editor)}</span>`:`<span class="chip amber">No editor</span>`}<span class="chip ${handoffCount(j)===3?"green":"amber"}">Handoff ${handoffCount(j)}/3</span></div></li>`).join("")}</ul>`
      : `<div class="empty">No shoots booked for today.<br><button class="btn" data-act="new">Book a job</button></div>`}
      ${tomorrow.length ? `<h3 style="margin-top:18px">Tomorrow</h3><ul class="attention">${tomorrow.map(j=>`<li><span class="dot blue"></span><div><button class="linkish" data-open="${esc(j.id)}">${esc(fmtTime(j.shootTime))}, ${esc(j.address||"No address")}</button><div class="why">${esc(j.client||"")}</div></div></li>`).join("")}</ul>`:""}
    </section>
    <section class="panel" aria-labelledby="nah">
      <h2 id="nah">Needs attention</h2>
      ${attn.length ? `<ul class="attention">${attn.slice(0,12).map(a=>`<li><span class="dot ${a.level}"></span><div><button class="linkish" data-open="${esc(a.j.id)}">${esc(a.j.address||a.j.client||a.j.jobNo)}</button><div class="why">${esc(a.why)}</div></div></li>`).join("")}</ul>${attn.length>12?`<p class="small muted">And ${attn.length-12} more on the jobs board.</p>`:""}`
      : `<p class="muted">Everything is on track. Overdue deliveries, missing handoffs, incomplete logo packs and jobs waiting on QC will show up here.</p>`}
    </section>
  </div>
  <div class="pipeline" role="list" aria-label="Jobs by stage">
    ${counts.map(([s,n])=>`<button role="listitem" data-stage="${esc(s)}"><span class="n ${n?"":"zero"}">${n}</span><span class="lbl">${esc(s)}</span></button>`).join("")}
  </div>`;
}

function viewJobs(){
  const f=S.filter, q=f.q.toLowerCase();
  let list = jobsArr().filter(j=>{
    if(f.type && j.type!==f.type) return false;
    if(q && ![j.jobNo,j.address,j.client,j.city,brokerageOf(j)?.name,j.editor].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const stages = STAGES.filter(s => f.archived || s!=="Archived").filter(s=>!f.stage || s===f.stage);
  const total = jobsArr().length;
  return `
  <h1>Jobs</h1>
  <p class="sub">Every job from booking to delivery. Open a job to hand it off to Dropbox, ClickUp and GHL, and to run QC.</p>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Search address, client, job no." value="${esc(f.q)}" aria-label="Search jobs">
    <select id="ft" aria-label="Job type"><option value="">All job types</option>${TYPES.map(t=>`<option ${f.type===t?"selected":""}>${t}</option>`).join("")}</select>
    <select id="fs" aria-label="Stage"><option value="">All stages</option>${STAGES.map(t=>`<option ${f.stage===t?"selected":""}>${t}</option>`).join("")}</select>
    <label class="row small" style="gap:6px"><input type="checkbox" id="fa" ${f.archived?"checked":""}> Show archived</label>
    <span class="spacer"></span>
    <button class="btn primary" data-act="new">Book a job</button>
  </div>
  ${!total ? `<div class="empty">No jobs yet. Book the first one and the hub will generate its Dropbox folder, ClickUp task and GHL details.<br><button class="btn primary" data-act="new">Book a job</button></div>` :
  `<div class="board-wrap"><div class="board">${stages.map(s=>{
    const col = list.filter(j=>j.stage===s).sort((a,b)=>(a.shootDate||"").localeCompare(b.shootDate||""));
    return `<div class="col"><div class="col-h"><span>${esc(s)}</span><span class="num">${col.length}</span></div>
      ${col.map(cardHTML).join("") || `<div class="small muted" style="padding:4px">—</div>`}</div>`;
  }).join("")}</div></div>`}`;
}
function cardHTML(j){
  const b=brokerageOf(j), t=todayISO(), idx=STAGES.indexOf(j.stage);
  const chips=[];
  if(j.dueDate && j.dueDate<t && idx<STAGES.indexOf("Delivered")) chips.push(`<span class="chip red">Overdue</span>`);
  chips.push(`<span class="chip ${handoffCount(j)===3?"green":"amber"}">Handoff ${handoffCount(j)}/3</span>`);
  if(j.type==="Real estate" && !logoReady(b)) chips.push(`<span class="chip amber">Logo pack</span>`);
  if(idx>=STAGES.indexOf("In edit") && idx<=STAGES.indexOf("QC")) chips.push(`<span class="chip ${qcDone(j)?"green":"blue"}">QC ${QC.filter(([k])=>j.qc?.[k]).length}/${QC.length}</span>`);
  return `<button class="card" data-open="${esc(j.id)}">
    <div class="id"><span>${esc(j.jobNo)}</span><span>${esc(j.type)}</span></div>
    <div class="t">${esc(j.address||"No address")}</div>
    <div class="m">${esc(j.client||"—")}${b&&j.type==="Real estate"?`, ${esc(b.name)}`:""}</div>
    <div class="m">Shoot ${esc(fmtDay(j.shootDate))} | Due ${esc(fmtDay(j.dueDate))}${j.editor?` | ${esc(j.editor)}`:""}</div>
    <div class="chips">${chips.join("")}</div></button>`;
}

function viewBrokerages(){
  const list = Object.values(S.brokerages).sort((a,b)=>a.name.localeCompare(b.name));
  const root=(S.settings.dropboxRoot||"").replace(/\/+$/,"");
  return `
  <h1>Brokerages</h1>
  <p class="sub">One logo pack per brokerage, kept in a single Dropbox folder and copied into every real estate job's <b>_Brand</b> folder. Florida advertising rules generally require the brokerage's licensed name on agent marketing, so a job isn't ready to deliver until its brokerage pack is complete. Confirm the exact requirements with Adam.</p>
  <div class="panel" style="margin:20px 0">
    <form id="addBrokerage" class="row" autocomplete="off">
      <label class="field" style="flex:1; min-width:220px">Brokerage name<input type="text" id="bname" placeholder="Licensed name, e.g. Coastal Realty Group LLC" required></label>
      <button class="btn primary" style="align-self:flex-end" ${S.readOnly?"disabled":""}>Add brokerage</button>
    </form>
  </div>
  ${list.length ? `<div class="blist">${list.map(b=>{
    const used = jobsArr().filter(j=>j.brokerageId===b.id && j.stage!=="Archived").length;
    return `<div class="bcard" data-bid="${esc(b.id)}">
      <div class="row"><h3 style="margin:0; font-size:17px">${esc(b.name)}</h3>
        <span class="chip ${logoReady(b)?"green":"amber"}">${logoReady(b)?"Logo pack complete":`${VARIANTS.filter(([k])=>b.variants?.[k]).length}/${VARIANTS.length} variants`}</span>
        <span class="small muted">${used} active job${used===1?"":"s"}</span><span class="spacer"></span>
        <button class="btn ghost sm danger" data-delb="${esc(b.id)}" ${S.readOnly?"disabled":""}>Remove</button></div>
      <div class="variants">${VARIANTS.map(([k,l])=>`<label><input type="checkbox" data-variant="${k}" ${b.variants?.[k]?"checked":""} ${S.readOnly?"disabled":""}> ${l}</label>`).join("")}</div>
      <div class="row small"><span class="muted" style="word-break:break-all">${esc(root)}/Brand Assets/Brokerages/${esc(safeName(b.name))}/</span>
        <button class="btn sm" data-copy="${esc(`${root}/Brand Assets/Brokerages/${safeName(b.name)}/`)}">Copy path</button></div>
      <label class="field" style="margin-top:10px">Compliance notes <span class="hint">Placement rules, required disclaimers, colors to avoid</span>
        <textarea data-bnotes rows="2" ${S.readOnly?"disabled":""}>${esc(b.notes||"")}</textarea></label>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-saveb ${S.readOnly?"disabled":""}>Save notes</button></div>
    </div>`;}).join("")}</div>`
  : `<div class="empty">No brokerages yet. Add the brokerages your realtor clients work under, then tick off each logo variant as it lands in Dropbox.</div>`}`;
}

function viewStandards(){
  return `
  <h1>Editing standards</h1>
  <p class="sub">Draft house standards built from Adam's feedback. Every job runs this checklist in its QC stage, and the hub won't move a job to client review until all of it is ticked. Refine the wording with Adam, then paste it into the ClickUp task template too.</p>
  <div class="panel" style="margin-top:20px">
    <ol class="std">${QC.map(([,t,d])=>`<li><div><h3>${esc(t)}</h3><div class="muted">${esc(d)}</div></div></li>`).join("")}</ol>
  </div>
  <div class="panel" style="margin-top:16px">
    <h2>How a job moves</h2>
    <ol class="std">
      <li><div><h3>Booked and scheduled</h3><div class="muted">Job exists in the hub. Dropbox folder, ClickUp task and GHL opportunity are set up and linked back here.</div></div></li>
      <li><div><h3>Shot</h3><div class="muted">Raw footage uploaded to 01_Raw. An editor is assigned before the job moves on.</div></div></li>
      <li><div><h3>In edit, then QC</h3><div class="muted">Editor cuts from 02_Selects. The studio manager runs the checklist above in QC.</div></div></li>
      <li><div><h3>Client review and revision</h3><div class="muted">Only reachable once QC is complete. Revisions loop back through QC.</div></div></li>
      <li><div><h3>Delivered and archived</h3><div class="muted">Final files in 05_Delivered, GHL stage updated, job archived after follow-up.</div></div></li>
    </ol>
  </div>`;
}

function viewConnections(){
  const s=S.settings, ro=S.readOnly?"disabled":"";
  return `
  <h1>Connections</h1>
  <p class="sub">For now the hub is the orchestrator: it generates what each tool needs and you create it there, then paste the link back into the job. Once Make.com scenarios are live, the same job data becomes the webhook payload and these handoffs happen on their own.</p>
  <div class="banner warn" style="margin-top:18px">Don't paste API tokens or webhook secrets here. Settings are visible to everyone signed in. Secrets belong in Vercel environment variables.</div>
  <form id="settingsForm" class="panel" autocomplete="off">
    <div class="grid2">
      <label class="field">Dropbox root folder <span class="hint">Job folders are created under this path</span><input type="text" name="dropboxRoot" value="${esc(s.dropboxRoot)}" ${ro}></label>
      <label class="field">Default turnaround (days) <span class="hint">Sets delivery due from the shoot date</span><input type="text" inputmode="numeric" name="turnaroundDays" value="${esc(s.turnaroundDays)}" ${ro}></label>
      <label class="field">ClickUp list link <span class="hint">The list where production tasks live</span><input type="url" name="clickupUrl" value="${esc(s.clickupUrl)}" placeholder="https://app.clickup.com/..." ${ro}></label>
      <label class="field">GHL location ID <span class="hint">#Cinema sub-account</span><input type="text" name="ghlLocation" value="${esc(s.ghlLocation)}" ${ro}></label>
      <label class="field">GHL app address <span class="hint">Change if you use a white-label domain</span><input type="url" name="ghlBase" value="${esc(s.ghlBase)}" ${ro}></label>
      <label class="field">Make.com scenario link <span class="hint">For quick access; the webhook comes later</span><input type="url" name="makeUrl" value="${esc(s.makeUrl)}" placeholder="https://eu1.make.com/..." ${ro}></label>
    </div>
    <label class="field" style="margin-top:14px">Editors <span class="hint">One name per line; these appear in the editor picker</span><textarea name="editors" rows="4" ${ro}>${esc(s.editors)}</textarea></label>
    <div class="row" style="margin-top:14px"><button class="btn primary" ${ro}>Save settings</button></div>
  </form>
  <div class="panel" style="margin-top:16px">
    <h2>Open a tool</h2>
    <div class="row">
      <a class="btn" href="https://www.dropbox.com/home${esc(encodeURI((s.dropboxRoot||"")).replace(/#/g,"%23"))}" target="_blank" rel="noopener">Dropbox</a>
      ${s.clickupUrl?`<a class="btn" href="${esc(s.clickupUrl)}" target="_blank" rel="noopener">ClickUp list</a>`:`<a class="btn" href="https://app.clickup.com" target="_blank" rel="noopener">ClickUp</a>`}
      <a class="btn" href="${esc(ghlOpenUrl())}" target="_blank" rel="noopener">GHL opportunities</a>
      <a class="btn" href="${esc(s.makeUrl||"https://www.make.com")}" target="_blank" rel="noopener">Make.com</a>
      <a class="btn" href="https://artlist.io" target="_blank" rel="noopener">Artlist</a>
    </div>
  </div>`;
}

/* ---------- drawer ---------- */
function blankJob(){
  const t=todayISO(), days=parseInt(S.settings.turnaroundDays,10)||2;
  return {id:null, jobNo:newJobNo(), stage:"Booked", type:"Real estate", package:"Photo + video", client:"", email:"", phone:"", brokerageId:"",
    address:"", city:"", shootDate:t, shootTime:"", dueDate:addDays(t,days), dueEdited:false, editor:"", notes:"", qc:{}, handoff:{}, createdAt:null};
}
function renderOverlay(){
  const host=$("#overlay");
  if(S.draft){ host.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dh">${draftHTML()}</aside>`; return; }
  const j = S.openJob && S.jobs[S.openJob];
  if(!j){ host.innerHTML=""; return; }
  host.innerHTML = `<div class="scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dh">${jobHTML(j)}</aside>`;
}
function detailsFields(j){
  const brs = Object.values(S.brokerages).sort((a,b)=>a.name.localeCompare(b.name));
  const ro = S.readOnly ? "disabled" : "";
  return `
  <div class="grid2">
    <label class="field">Job type<select name="type" ${ro}>${TYPES.map(t=>`<option ${j.type===t?"selected":""}>${t}</option>`).join("")}</select></label>
    <label class="field">Package<select name="package" ${ro}>${PACKAGES.map(t=>`<option ${j.package===t?"selected":""}>${t}</option>`).join("")}</select></label>
    <label class="field">${j.type==="Real estate"?"Agent":"Client"} name<input type="text" name="client" value="${esc(j.client)}" required ${ro}></label>
    <label class="field">Email<input type="email" name="email" value="${esc(j.email)}" ${ro}></label>
    <label class="field">Phone<input type="tel" name="phone" value="${esc(j.phone)}" ${ro}></label>
    ${j.type==="Real estate" ? `<label class="field">Brokerage <span class="hint">${brs.length?"":"Add brokerages on the Brokerages page"}</span><select name="brokerageId" ${ro}><option value="">Pick a brokerage</option>${brs.map(b=>`<option value="${esc(b.id)}" ${j.brokerageId===b.id?"selected":""}>${esc(b.name)}</option>`).join("")}</select></label>` : `<div></div>`}
    <label class="field">${j.type==="Real estate"?"Property address":"Location"}<input type="text" name="address" value="${esc(j.address)}" required ${ro}></label>
    <label class="field">City<input type="text" name="city" value="${esc(j.city)}" ${ro}></label>
    <label class="field">Shoot date<input type="date" name="shootDate" value="${esc(j.shootDate)}" required ${ro}></label>
    <label class="field">Call time<input type="time" name="shootTime" value="${esc(j.shootTime)}" ${ro}></label>
    <label class="field">Delivery due<input type="date" name="dueDate" value="${esc(j.dueDate)}" ${ro}></label>
    <label class="field">Editor<input type="text" name="editor" list="edlist" value="${esc(j.editor)}" placeholder="${editors().length?"Pick or type a name":"Add editors under Connections"}" ${ro}><datalist id="edlist">${editors().map(e=>`<option value="${esc(e)}">`).join("")}</datalist></label>
  </div>
  <label class="field" style="margin-top:14px">Notes <span class="hint">Access, parking, lockbox, client requests</span><textarea name="notes" ${ro}>${esc(j.notes)}</textarea></label>`;
}
function draftHTML(){
  const j=S.draft;
  return `
  <div class="drawer-top"><div style="flex:1"><div class="small muted">${esc(j.jobNo)}</div><h1 id="dh">Book a job</h1></div><button class="btn ghost" data-close aria-label="Close">Close</button></div>
  <form id="draftForm" class="section" autocomplete="off">
    ${detailsFields(j)}
    <div class="row" style="margin-top:16px"><button class="btn primary" ${S.readOnly?"disabled":""}>Create job</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
  </form>`;
}
function jobHTML(j){
  const idx=STAGES.indexOf(j.stage), b=brokerageOf(j);
  const ro = S.readOnly ? "disabled" : "";
  const warn = [];
  if(j.type==="Real estate" && !b) warn.push("Pick a brokerage so the right logo pack goes into this job.");
  else if(j.type==="Real estate" && !logoReady(b)) warn.push(`${b.name}'s logo pack is missing variants. Finish it on the Brokerages page before delivery.`);
  const hand = (key,title,body,copyMain,openHref,openLabel,copyLabel) => {
    const h=j.handoff?.[key]||{};
    return `<div class="handoff" data-hkey="${key}">
      <div class="handoff-h"><h3>${title}</h3><span class="chip ${h.done?"green":"amber"}">${h.done?"Done":"To do"}</span><span class="spacer"></span>
        <button class="btn sm" data-copy="${esc(copyMain)}">${copyLabel}</button>
        ${openHref?`<a class="btn sm" href="${esc(openHref)}" target="_blank" rel="noopener">${openLabel}</a>`:""}</div>
      <pre class="out">${esc(body)}</pre>
      <div class="row">
        <input type="url" data-hlink placeholder="Paste the link once it's created" value="${esc(h.link||"")}" style="flex:1; min-width:200px" ${ro}>
        ${h.link?`<a class="btn sm" href="${esc(h.link)}" target="_blank" rel="noopener">Open</a>`:""}
        <label class="row small" style="gap:6px"><input type="checkbox" data-hdone ${h.done?"checked":""} ${ro}> Done</label>
      </div></div>`;
  };
  return `
  <div class="drawer-top">
    <div style="flex:1; min-width:0"><div class="small muted">${esc(j.jobNo)} | ${esc(j.type)}${j.createdAt?` | booked ${esc(fmtDay(j.createdAt.slice(0,10)))}`:""}</div>
      <h1 id="dh">${esc(j.address||"No address")}</h1>
      <div class="muted" style="margin-top:6px">${esc(j.client||"—")}${b&&j.type==="Real estate"?`, ${esc(b.name)}`:""} | Shoot ${esc(fmtDay(j.shootDate))} ${esc(fmtTime(j.shootTime))} | Due ${esc(fmtDay(j.dueDate))}</div></div>
    <button class="btn ghost" data-close aria-label="Close">Close</button>
  </div>
  <section class="section" aria-label="Stage">
    <div class="row"><h2 style="margin:0">${esc(j.stage)}</h2><span class="small muted">Stage ${idx+1} of ${STAGES.length}</span><span class="spacer"></span>
      <button class="btn sm" data-stagemove="-1" ${idx===0||S.readOnly?"disabled":""}>Move back</button>
      <button class="btn sm primary" data-stagemove="1" ${idx===STAGES.length-1||S.readOnly?"disabled":""}>Move to ${esc(STAGES[Math.min(idx+1,STAGES.length-1)])}</button></div>
    <div class="stagerail" aria-hidden="true">${STAGES.map((s,i)=>`<div class="${i<idx?"done":i===idx?"now":""}" title="${esc(s)}"></div>`).join("")}</div>
    ${warn.map(w=>`<div class="banner warn" style="margin:8px 0 0">${esc(w)}</div>`).join("")}
  </section>

  <section class="section" aria-labelledby="hoh">
    <div class="row"><h2 id="hoh" style="margin:0">Handoff</h2><span class="chip ${handoffCount(j)===3?"green":"amber"}">${handoffCount(j)}/3 done</span></div>
    <p class="small muted" style="margin:-4px 0 14px">Create each item in its tool with the details below, paste its link back, and tick it off.</p>
    ${hand("dropbox","Dropbox folder",dropboxBlock(j),dropboxPath(j),dropboxOpenUrl(j),"Open Dropbox","Copy path")}
    ${hand("clickup","ClickUp task",`${clickupTitle(j)}\n\n${clickupBody(j)}`,`${clickupTitle(j)}\n\n${clickupBody(j)}`,S.settings.clickupUrl||"https://app.clickup.com","Open ClickUp","Copy task")}
    ${hand("ghl","GHL opportunity",ghlBlock(j),ghlBlock(j),ghlOpenUrl(),"Open GHL","Copy details")}
    <details style="margin-top:14px"><summary>Make.com payload</summary>
      <p class="small muted">The same job as JSON. When the Make webhook is ready, this is what the hub will send.</p>
      <pre class="out">${esc(makePayload(j))}</pre><div class="row"><button class="btn sm" data-copy="${esc(makePayload(j))}">Copy JSON</button>${S.mode==="cloud"?`<button class="btn sm" data-sendmake>Send to Make</button>`:""}</div></details>
  </section>

  <section class="section" aria-labelledby="qch">
    <div class="row"><h2 id="qch" style="margin:0">QC checklist</h2><span class="chip ${qcDone(j)?"green":"blue"}">${QC.filter(([k])=>j.qc?.[k]).length}/${QC.length}</span></div>
    ${QC.map(([k,t,d])=>`<label class="check"><input type="checkbox" data-qc="${k}" ${j.qc?.[k]?"checked":""} ${ro}><span><b>${esc(t)}</b><span class="d">${esc(d)}</span></span></label>`).join("")}
  </section>

  <form id="jobForm" class="section" autocomplete="off" aria-labelledby="deh">
    <h2 id="deh">Details</h2>
    ${detailsFields(j)}
    <div class="row" style="margin-top:16px"><button class="btn primary" ${ro}>Save changes</button><span class="spacer"></span>
      <button type="button" class="btn danger" data-deljob ${ro}>Delete job</button></div>
  </form>`;
}

/* ---------- persistence ---------- */
// The store is either local (this browser only) or Supabase (shared, signed-in team).
// Both expose the same methods; see src/store/.
let store=null;
const queues={};
function queued(key, fn){
  queues[key]=(queues[key]||Promise.resolve()).then(fn).catch(e=>{
    console.error(e);
    const msg = String(e?.message||"");
    if(/JWT|auth|401|403|permission/i.test(msg)){ toast("Your session expired. Sign in again."); }
    else toast("Couldn't save. Check your connection and try again.");
  });
  return queues[key];
}
const clone = o => JSON.parse(JSON.stringify(o));
function putJob(j){ j.updatedAt=new Date().toISOString(); S.jobs[j.id]=j; const c=clone(j); queued("job:"+j.id, ()=>store.saveJob(c)); }
function removeJob(id){ delete S.jobs[id]; queued("job:"+id, ()=>store.deleteJob(id)); }
function putBrokerage(b){ S.brokerages[b.id]=b; const c=clone(b); queued("br:"+b.id, ()=>store.saveBrokerage(c)); }
function removeBrokerage(id){ delete S.brokerages[id]; queued("br:"+id, ()=>store.deleteBrokerage(id)); }
function putSettings(s){ S.settings=s; const c=clone(s); queued("settings", ()=>store.saveSettings(c)); }

// Avoid wiping what someone is typing when a live update lands.
function softRender(){
  const a=document.activeElement;
  if(a && a.closest && a.closest("form, .handoff, .bcard") && ["INPUT","TEXTAREA","SELECT"].includes(a.tagName)){ softRender.pending=true; return; }
  render();
}
document.addEventListener("focusout", ()=>{ setTimeout(()=>{ if(softRender.pending){ const a=document.activeElement; if(!(a && ["INPUT","TEXTAREA","SELECT"].includes(a.tagName))){ softRender.pending=false; render(); } } },0); });

async function sendToMake(j){
  const token = await store.accessToken?.();
  if(!token){ toast("Sign in to send jobs to Make"); return; }
  try{
    const r = await fetch("/api/make", {method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`}, body:makePayload(j)});
    const body = await r.json().catch(()=>({}));
    toast(r.ok ? "Sent to Make" : (body.error || `Make relay failed (${r.status})`));
  }catch(e){ toast("Couldn't reach the Make relay. It only runs on Vercel or with `vercel dev`."); }
}

function viewLogin(){
  return `
  <h1>Sign in</h1>
  <p class="sub">The studio hub is for the #Cinema Studios team. Enter your work email and we'll send you a sign-in link.</p>
  <form id="loginForm" class="panel" style="max-width:460px; margin-top:20px" autocomplete="on">
    <label class="field">Work email<input type="email" name="email" required autocomplete="email"></label>
    <div class="row" style="margin-top:14px"><button class="btn primary">Email me a sign-in link</button></div>
    <p class="small muted" id="loginMsg" style="margin:10px 0 0">Only people invited to the hub can sign in.</p>
  </form>`;
}

/* ---------- events ---------- */
function formData(form){
  const o={}; new FormData(form).forEach((v,k)=>o[k]=typeof v==="string"?v.trim():v); return o;
}
function go(view){ S.view=view; S.openJob=null; S.draft=null; render(); $("#main").focus({preventScroll:true}); window.scrollTo(0,0); }

document.addEventListener("click", e=>{
  const t=e.target.closest("button, a, [data-close], .scrim"); if(!t) return;
  if(t.dataset.view){ go(t.dataset.view); return; }
  if(t.dataset.act==="signout"){ store.signOut().then(()=>location.reload()); return; }
  if(t.dataset.sendmake!==undefined){ const j=S.jobs[S.openJob]; if(j) sendToMake(j); return; }
  if(t.id==="newJobBtn" || t.dataset.act==="new"){ if(S.auth!=="in") return; S.draft=blankJob(); S.openJob=null; renderOverlay(); return; }
  if(t.dataset.act==="carry"){ const c=S.localCarry; S.localCarry=null;
    Object.values(c.brokerages).forEach(b=>putBrokerage(b)); Object.values(c.jobs).forEach(j=>putJob(j));
    clearLocalSnapshot(); toast(`Moved ${c.n} job${c.n>1?"s":""} to the shared workspace`); render(); return; }
  if(t.hasAttribute("data-close")){ S.openJob=null; S.draft=null; renderOverlay(); return; }
  if(t.dataset.open){ S.openJob=t.dataset.open; S.draft=null; renderOverlay(); return; }
  if(t.dataset.stage){ S.filter.stage=t.dataset.stage; go("jobs"); return; }
  if(t.dataset.copy!==undefined){ copyText(t.dataset.copy); return; }
  if(t.dataset.stagemove){
    const j={...S.jobs[S.openJob]}; const idx=STAGES.indexOf(j.stage), to=idx+Number(t.dataset.stagemove);
    if(to<0||to>=STAGES.length) return;
    if(to>=REVIEW_INDEX && idx<REVIEW_INDEX && !qcDone(j)){ toast("Finish the QC checklist before client review"); return; }
    if(STAGES[to]==="In edit" && !j.editor){ toast("Assign an editor before moving into edit"); return; }
    if(STAGES[to]==="Delivered" && j.type==="Real estate" && !logoReady(brokerageOf(j))){ toast("Complete the brokerage logo pack before delivery"); return; }
    j.stage=STAGES[to]; putJob(j); toast(`Moved to ${j.stage}`); render(); return;
  }
  if(t.hasAttribute("data-deljob")){
    const j=S.jobs[S.openJob]; if(!j) return;
    if(!confirm(`Delete ${j.jobNo} (${j.address||"no address"})? This only removes it from the hub, not from Dropbox, ClickUp or GHL.`)) return;
    removeJob(j.id); S.openJob=null; toast("Job deleted"); render(); return;
  }
  if(t.dataset.delb){
    const b=S.brokerages[t.dataset.delb]; const used=jobsArr().filter(j=>j.brokerageId===b.id).length;
    if(!confirm(`Remove ${b.name}?${used?` ${used} job${used>1?"s":""} will show no brokerage.`:""}`)) return;
    removeBrokerage(b.id); toast("Brokerage removed"); render(); return;
  }
  if(t.hasAttribute("data-saveb")){
    const card=t.closest(".bcard"), b={...S.brokerages[card.dataset.bid]};
    b.notes=card.querySelector("[data-bnotes]").value.trim(); putBrokerage(b); toast("Notes saved"); return;
  }
});

document.addEventListener("change", e=>{
  const t=e.target;
  if(t.id==="ft"){ S.filter.type=t.value; render(); return; }
  if(t.id==="fs"){ S.filter.stage=t.value; render(); return; }
  if(t.id==="fa"){ S.filter.archived=t.checked; render(); return; }
  if(t.dataset.qc){ const j={...S.jobs[S.openJob]}; j.qc={...(j.qc||{}), [t.dataset.qc]:t.checked}; putJob(j); renderOverlay(); return; }
  if(t.hasAttribute("data-hdone") || t.hasAttribute("data-hlink")){
    const box=t.closest(".handoff"), key=box.dataset.hkey, j={...S.jobs[S.openJob]};
    const cur={...(j.handoff?.[key]||{})};
    if(t.hasAttribute("data-hdone")) cur.done=t.checked;
    else { cur.link=t.value.trim(); if(cur.link && !cur.done) cur.done=true; }
    j.handoff={...(j.handoff||{}), [key]:cur}; putJob(j);
    if(t.hasAttribute("data-hlink") && cur.link) toast("Link saved and marked done");
    renderOverlay(); return;
  }
  if(t.dataset.variant){ const card=t.closest(".bcard"); const b={...S.brokerages[card.dataset.bid]}; b.variants={...(b.variants||{}), [t.dataset.variant]:t.checked}; putBrokerage(b); render(); return; }
  // Live form tweaks: job type changes the fields shown, shoot date moves the due date.
  const form=t.closest("#draftForm, #jobForm");
  if(form && (t.name==="type" || t.name==="shootDate" || t.name==="dueDate")){
    const target = form.id==="draftForm" ? S.draft : null;
    if(target){
      Object.assign(target, formData(form));
      if(t.name==="dueDate") target.dueEdited=true;
      if(t.name==="shootDate" && !target.dueEdited && target.shootDate) target.dueDate=addDays(target.shootDate, parseInt(S.settings.turnaroundDays,10)||2);
      if(t.name==="type") renderOverlay(); else form.querySelector('[name="dueDate"]').value=target.dueDate;
    } else if(t.name==="type"){
      // Rebuild the details fields for the new type without saving yet.
      const j={...S.jobs[S.openJob], ...formData(form)}; const tmp=document.createElement("div"); tmp.innerHTML=detailsFields(j);
      const grid=form.querySelector(".grid2"); grid.replaceWith(tmp.querySelector(".grid2"));
    }
  }
});

let qTimer;
document.addEventListener("input", e=>{
  if(e.target.id==="q"){ clearTimeout(qTimer); const v=e.target.value; qTimer=setTimeout(()=>{ S.filter.q=v; render(); const q=$("#q"); if(q){ q.focus(); q.setSelectionRange(v.length,v.length);} },220); }
});

document.addEventListener("submit", e=>{
  e.preventDefault();
  const f=e.target;
  if(f.id==="loginForm"){
    const email=formData(f).email, msg=$("#loginMsg"), btn=f.querySelector("button");
    btn.disabled=true; msg.textContent="Sending…";
    store.signIn(email).then(()=>{ msg.textContent=`Check ${email} for a sign-in link. You can close this tab.`; })
      .catch(err=>{ btn.disabled=false; msg.textContent = /signups not allowed|not found|Signups/i.test(err.message||"") ? "That email isn't invited to the hub yet. Ask an admin to add you." : `Couldn't send the link: ${err.message}`; });
    return;
  }
  if(f.id==="draftForm"){
    const d={...S.draft, ...formData(f)};
    if(!d.client || !d.address || !d.shootDate){ toast("Add a name, address and shoot date"); return; }
    d.id=uid(); d.createdAt=new Date().toISOString(); d.stage = d.shootTime ? "Scheduled" : "Booked";
    putJob(d); S.draft=null; S.openJob=d.id; toast(`${d.jobNo} booked`); render();
    setTimeout(()=>{ const h=document.getElementById("hoh"); if(h) h.scrollIntoView({block:"start"}); },60);
    return;
  }
  if(f.id==="jobForm"){
    const j={...S.jobs[S.openJob], ...formData(f)};
    if(!j.client || !j.address){ toast("Name and address are required"); return; }
    if(j.type!=="Real estate") j.brokerageId="";
    putJob(j); toast("Changes saved"); render(); return;
  }
  if(f.id==="addBrokerage"){
    const name=$("#bname").value.trim(); if(!name) return;
    if(Object.values(S.brokerages).some(b=>b.name.toLowerCase()===name.toLowerCase())){ toast(`${name} is already on the list`); return; }
    putBrokerage({id:uid(), name, variants:{}, notes:"", createdAt:new Date().toISOString()}); toast(`${name} added`); render(); return;
  }
  if(f.id==="settingsForm"){
    const s={...S.settings, ...formData(f)}; s.turnaroundDays=Math.max(0,parseInt(s.turnaroundDays,10)||2);
    putSettings(s); toast("Settings saved"); render(); return;
  }
});
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && (S.openJob||S.draft)){ S.openJob=null; S.draft=null; renderOverlay(); } });

/* ---------- boot ---------- */
async function startData(){
  if(startData.done) return; startData.done=true;
  await store.start(d=>{
    if(d.jobs) S.jobs=d.jobs;
    if(d.brokerages) S.brokerages=d.brokerages;
    if(d.settings) S.settings={...DEFAULT_SETTINGS, ...d.settings};
    softRender();
  });
  if(S.mode==="cloud"){
    const legacy=readLocalSnapshot();
    const n=Object.keys(legacy?.jobs||{}).length;
    if(n) S.localCarry={n, jobs:legacy.jobs, brokerages:legacy.brokerages||{}};
  }
  render();
}
async function boot(){
  const url=import.meta.env.VITE_SUPABASE_URL, key=import.meta.env.VITE_SUPABASE_ANON_KEY;
  if(url && key){
    store=createSupabaseStore(url,key); S.mode="cloud";
    const session=await store.session();
    S.auth = session ? "in" : "needs-login";
    store.onAuth(s=>{ const was=S.auth; S.auth = s ? "in" : "needs-login"; if(s && was!=="in") startData(); render(); });
    render();
    if(session) startData();
  } else {
    store=createLocalStore(); S.mode="local"; S.auth="in";
    render(); startData();
  }
}
boot();
