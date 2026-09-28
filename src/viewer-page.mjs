export function viewerPage(clientId, nonce) {
  const safeClientId = JSON.stringify(clientId).slice(1, -1).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="shopify-api-key" content="${safeClientId}">
<title>Firgelli inventory sync</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17202d;background:#f5f7f8}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 28px 80px}
.eyebrow{color:#6b7280;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h1{font-size:30px;letter-spacing:-.04em;margin:6px 0 8px}h2{font-size:17px;letter-spacing:-.02em;margin:0}p{margin:0;color:#5b6472;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:28px}
.refresh{border:1px solid #c8d0d6;background:#fff;border-radius:9px;padding:9px 15px;font:inherit;font-size:13px;font-weight:650;color:#1c2a37;cursor:pointer}
.refresh:hover{background:#edf4f5}.refresh:disabled{opacity:.5;cursor:wait}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}
.card,.panel{background:#fff;border:1px solid #e1e6e8;border-radius:14px;box-shadow:0 2px 8px #15223408}
.card{padding:19px 20px}.card .label{font-size:12px;color:#65717d;font-weight:650}.card .value{font-size:28px;letter-spacing:-.045em;font-weight:750;margin-top:6px}.card .hint{font-size:12px;color:#75808a;margin-top:4px}
.value.good{color:#0d7658}.value.off{color:#9b5a11}.value.bad{color:#b42318}
.banner{border-radius:11px;padding:13px 16px;margin-bottom:22px;font-size:13px;line-height:1.5;background:#fff5e7;border:1px solid #f0d5ad;color:#734911}
.banner.good{background:#eaf8f2;border-color:#b7e4cf;color:#126044}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}.panel{padding:22px}.panelhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.muted{font-size:12px;color:#71808a}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fact{border-top:1px solid #eff1f2;padding-top:10px}.fact b{display:block;font-size:13px;margin-top:3px}.fact span{font-size:11px;color:#6b7580}
.toolbar{display:flex;gap:10px;align-items:center;margin:14px 0}.search{width:220px;max-width:100%;border:1px solid #cdd5d9;border-radius:8px;padding:9px 11px;font:inherit;font-size:13px}.tabs{display:flex;gap:5px}.tab{border:0;border-radius:7px;padding:9px 11px;background:transparent;color:#65717b;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.tab.active{background:#e7f2ef;color:#08634a}
.list{border-top:1px solid #edf0f2}.entry{display:grid;grid-template-columns:115px minmax(0,1fr) auto;gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid #edf0f2}.entry:last-child{border-bottom:0}
.badge{display:inline-block;padding:5px 8px;border-radius:6px;background:#eff5f3;color:#14735b;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.04em}.badge.warning{background:#fff2dc;color:#8b5a0b}.badge.error{background:#fdecea;color:#b42318}
.entry strong{display:block;font-size:13px;line-height:1.4}.entry small{display:block;color:#65717b;font-size:12px;margin-top:4px;line-height:1.45}.time{font-size:11px;color:#7d8790;white-space:nowrap}
.empty{padding:28px 0;text-align:center;color:#687681;font-size:13px}.errorbox{background:#fdecea;color:#a42920;border:1px solid #f1c5bf;border-radius:9px;padding:13px 15px;font-size:13px}
@media(max-width:860px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}}
@media(max-width:550px){main{padding:22px 16px 60px}.grid{gap:8px}.card{padding:14px}.card .value{font-size:23px}.header{align-items:center}.entry{grid-template-columns:1fr auto}.entry .badge{grid-column:1/-1;width:max-content}.toolbar{flex-wrap:wrap}}
</style></head><body><main>
<div class="header"><div><div class="eyebrow">Firgelli • inventory operations</div><h1>Inventory sync</h1><p>Read-only view of the two-store stock connection.</p></div><button class="refresh" id="refresh">Refresh</button></div>
<div id="banner" class="banner">Loading current status…</div>
<div class="grid">
<div class="card"><div class="label">Live syncing</div><div class="value" id="live">—</div><div class="hint">Both stores</div></div>
<div class="card"><div class="label">Tracked SKUs</div><div class="value" id="tracked">—</div><div class="hint">Initialized for syncing</div></div>
<div class="card"><div class="label">Pending work</div><div class="value" id="pending">—</div><div class="hint">Changes and retries</div></div>
<div class="card"><div class="label">New SKU candidates</div><div class="value" id="new">—</div><div class="hint">Found in daily discovery</div></div>
</div>
<div class="two"><section class="panel"><div class="panelhead"><h2>Connection details</h2></div><div class="facts">
<div class="fact"><span>Main store</span><b>Firgelli Automation · 1350 Slater Road</b></div>
<div class="fact"><span>Child store</span><b>Firgelli · Warehouse</b></div>
<div class="fact"><span>Last daily discovery</span><b id="discovery">—</b></div>
<div class="fact"><span>Last completed stock scan</span><b id="scan">—</b></div>
</div></section><section class="panel"><div class="panelhead"><h2>Needs attention</h2><span class="muted" id="problemCount"></span></div><div id="problems" class="list"></div></section></div>
<section class="panel"><div class="panelhead"><div><h2>Activity history</h2><p class="muted">Recent events recorded by this app. Times shown in your local time zone.</p></div><span class="muted" id="updated"></span></div>
<div class="toolbar"><input id="search" class="search" type="search" placeholder="Filter by SKU" aria-label="Filter by SKU"><div class="tabs"><button class="tab active" data-filter="all">All</button><button class="tab" data-filter="problems">Warnings & errors</button><button class="tab" data-filter="changes">Stock changes</button></div></div><div id="activity" class="list"></div></section>
</main><script nonce="${nonce}">
const el=id=>document.getElementById(id);let data=null,filter='all';
const date=value=>value?new Date(value).toLocaleString(): 'Not yet recorded';
const names={webhook:'Stock change received',change:'Stock change detected',write:'Quantity updated',
  bootstrap:'SKU initialized',auto_enroll:'New SKU enrolled',discovery:'Daily SKU check',
  scan_complete:'Backup scan completed',scan_error:'SKU check failed',retry:'Update will retry',
  stale:'Stock changed during update',negative_blocked:'Negative stock prevented',
  cloud_error:'App operation failed',worker_error:'Sync worker failed',auto_enroll_error:'New SKU enrollment failed'};
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=String(text);return e}
function line(e){const title=names[e.type]||e.type;const sku=e.sku?' · '+e.sku:'';const side=e.side==='main'?'Main store':e.side==='child'?'Child store':'';
  const quantity=e.from_qty!==null&&e.to_qty!==null?' · '+e.from_qty+' → '+e.to_qty:'';
  return {title:title+sku,detail:[side+quantity,e.message].filter(Boolean).join(' · ')};}
function renderRows(target,rows,empty){const box=el(target);box.replaceChildren();if(!rows.length){box.append(node('div','empty',empty));return}
  for(const e of rows){const row=node('div','entry');row.append(node('span','badge '+(e.level==='error'?'error':e.level==='warning'?'warning':''),e.level));
    const body=node('div');const info=line(e);body.append(node('strong','',info.title));if(info.detail)body.append(node('small','',info.detail));row.append(body,node('span','time',date(e.at)));box.append(row)}}
function render(){if(!data)return;const s=data.status;el('live').textContent=s.syncEnabled&&s.inventoryWritesEnabled?'On':'Paused';el('live').className='value '+(s.syncEnabled&&s.inventoryWritesEnabled?'good':'off');
  el('tracked').textContent=s.initializedSkus;el('pending').textContent=s.pendingJobs+s.pendingWrites;el('pending').className='value '+(s.pendingJobs+s.pendingWrites?'bad':'good');
  el('new').textContent=s.discovery.candidateCount;el('discovery').textContent=date(s.discovery.lastScanAt);el('scan').textContent=date(data.lastCompletedScan);
  el('updated').textContent='Updated '+new Date().toLocaleTimeString();const banner=el('banner');banner.className='banner '+(s.syncEnabled&&s.inventoryWritesEnabled?'good':'');
  banner.textContent=s.syncEnabled&&s.inventoryWritesEnabled?'Live syncing is on. Inventory changes can update the other store.':'Sync is paused. Shopify inventory changes are not being copied between stores.';
  const activeRetries=data.pendingWrites.filter(w=>w.attempts>0);
  const problems=[...activeRetries.map(w=>({at:new Date(w.next_at).toISOString(),level:'error',type:'retry',sku:w.sku,side:w.side,from_qty:w.from_qty,to_qty:w.to_qty,message:w.last_error||'Pending retry'})),...data.problems];
  el('problemCount').textContent=activeRetries.length+' active retries';renderRows('problems',problems.slice(0,5),'No recent warnings or failed updates.');
  const q=el('search').value.trim().toLowerCase();let rows=data.activity.filter(e=>!q||e.sku?.toLowerCase().includes(q));
  if(filter==='problems')rows=rows.filter(e=>e.level!=='info');if(filter==='changes')rows=rows.filter(e=>['change','write','bootstrap','auto_enroll'].includes(e.type));
  renderRows('activity',rows,'No events match this view.');}
async function load(){const btn=el('refresh');btn.disabled=true;try{if(!window.shopify?.idToken)throw Error('Open this page from the installed app in Shopify admin.');
  const token=await window.shopify.idToken();const res=await fetch('/viewer/overview',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  if(!res.ok)throw Error(res.status===401?'Shopify session could not be verified. Check the app client secret in Cloudflare.':'Status is temporarily unavailable ('+res.status+').');
  data=await res.json();render()}catch(err){el('banner').className='errorbox';el('banner').textContent=err.message}finally{btn.disabled=false}}
el('refresh').addEventListener('click',load);el('search').addEventListener('input',render);
for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{filter=tab.dataset.filter;for(const t of document.querySelectorAll('.tab'))t.classList.toggle('active',t===tab);render()});
load();setInterval(load,60000);
</script></body></html>`;
}
