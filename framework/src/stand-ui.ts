export const standHTML = `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARC Stand</title><style>
:root{font-family:ui-sans-serif,system-ui;color:#dce8f5;background:#0b111b;color-scheme:dark}*{box-sizing:border-box}body{margin:0}header{padding:24px 32px;border-bottom:1px solid #263245;display:flex;justify-content:space-between;align-items:center}h1{font-size:23px;margin:0;letter-spacing:3px}small,.muted{color:#8fabc6}main{padding:24px;max-width:1600px;margin:auto}.stats{display:flex;gap:18px;margin-bottom:24px;flex-wrap:wrap}.stat{background:#121e2d;padding:16px 22px;border:1px solid #29394d;border-radius:10px;min-width:160px}.stat b{display:block;font-size:26px;color:#7ee2c0}.layout{display:grid;grid-template-columns:minmax(350px,1.3fr) minmax(330px,1fr);gap:20px}.panel{border:1px solid #29394d;border-radius:12px;background:#101a28;padding:22px;margin-bottom:20px}h2{font-size:16px;margin:0 0 18px}button,select,input,textarea{font:inherit;border:1px solid #36475f;border-radius:6px;padding:9px;background:#17273b;color:inherit}button{cursor:pointer}button:hover{border-color:#7ee2c0}button.primary{background:#246957}textarea{width:100%;min-height:155px;font:13px ui-monospace,monospace;resize:vertical}select{max-width:100%}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}pre{font:12px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;background:#0a121e;padding:14px;border-radius:7px}label{font-size:12px;color:#9eb4ca;display:block;margin:12px 0 6px}#graph{overflow:auto;max-height:65vh;min-height:140px;background:#0a121e;border:1px solid #29394d;border-radius:8px}
#graph svg{display:block}#graph p{padding:0 16px}.graph-tools{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px}
.graph-tools label{display:flex;align-items:center;gap:6px;margin:0}.graph-tools input{padding:0;width:96px}
svg text{font-family:ui-monospace,monospace;font-size:13px;fill:#dce8f5}svg text.detail{font-size:11px;fill:#a4bdd3}
svg .node{cursor:pointer;outline:none}svg .node rect{fill:#172b3e;stroke:#43617b}
svg .node.browser rect{fill:#173c31}svg .node.shared rect{fill:#39264e}svg .node.active rect{fill:#765b20}
svg .node:is(:hover,:focus-visible,.selected) rect{stroke:#7ee2c0;stroke-width:2}
svg .edge{fill:none;stroke:#829bb3;stroke-width:1.5;marker-end:url(#arrow-default);pointer-events:stroke}
svg .edge.remote{stroke-dasharray:6 4}svg .edge.muted{opacity:.25}
svg .edge.incoming{stroke:#8fcaff;marker-end:url(#arrow-incoming)}svg .edge.outgoing{stroke:#7ee2c0;marker-end:url(#arrow-outgoing)}
svg .edge.incoming,svg .edge.outgoing,svg .edge:hover{opacity:1;stroke-width:2.5}
.graph-incoming{color:#8fcaff}.graph-outgoing{color:#7ee2c0}
table{width:100%;font-size:12px;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #29394d}.badge{color:#7ee2c0}#message{color:#ffbf86;min-height:20px}a{color:#7ee2c0}@media(max-width:850px){.layout{grid-template-columns:1fr}header{padding:18px}main{padding:12px}}
</style><header><div><h1>◈ ARC <span class="muted">STAND</span></h1><small>Architecture · Runtime · Compiler</small></div><span class="badge">● LOCAL DEVELOPMENT</span></header><main><div class="stats" id="stats"></div><div id="message" role="status"></div><section class="panel"><h2>Executable architecture</h2><div class="graph-tools"><select id="runtimeFilter" aria-label="Runtime filter"><option value="all">All</option><option value="browser">Frontend</option><option value="server">Backend</option><option value="boundaries">Boundaries</option></select><label>Масштаб <input id="graphZoom" type="range" min="5" max="150" step="1" value="100"><output id="graphZoomValue" for="graphZoom">100%</output></label><button type="button" id="graphFit">Увесь граф</button><small>Для вибраного вузла: <span class="graph-incoming">вхідні</span> · <span class="graph-outgoing">вихідні</span>. Пунктир — віддалений виклик.</small></div><div id="graph" role="region" aria-label="Application dependency graph" tabindex="0"></div></section><div class="layout"><div><section class="panel"><h2>Runtime · rolling window / незалежні metrics</h2><table><thead><tr><th>Operation</th><th>Active / RPM</th><th>p50</th><th>p95 / p99</th><th>Errors</th></tr></thead><tbody id="metrics"></tbody></table></section><section class="panel"><h2>Browser telemetry</h2><pre id="browserMetrics"></pre></section><section class="panel"><h2>Interaction trace</h2><select id="interactionSelect"></select><pre id="interaction"></pre><small>Remote duration includes network + server; clocks are not synchronized.</small></section><section class="panel"><h2>Traces</h2><select id="traceSelect" aria-label="Trace"></select><pre id="trace">Запустіть операцію для запису trace.</pre></section></div><div><section class="panel"><h2 id="selectedTitle">Operation explorer</h2><select id="operation" aria-label="Operation"></select><pre id="contract"></pre><div class="row"><button id="valid">Generate valid</button><button id="invalid">Generate invalid</button><select id="corpus" aria-label="Generated case"></select><select id="mode" aria-label="Transport"><option value="operation">Operation</option><option value="http">Local HTTP handler</option><option value="network">Real local network</option></select></div><label for="input">Input JSON</label><textarea id="input" spellcheck="false"></textarea><label for="auth">Authorization (для orders: Bearer + UUID demo-користувача)</label><input id="auth" style="width:100%" value="Bearer 00000000-0000-4000-8000-000000000001"><div class="row"><button class="primary" id="run">Run operation</button><button id="save">Save as test</button><button id="tests">Run tests</button><button id="exportTests">Export JSON</button><button id="persistTests">Save to disk</button><label><input type="checkbox" id="saveContext">Include authorization</label><label>Import JSON<input type="file" id="importTests" accept="application/json"></label><label>Expected matcher JSON<textarea id="matcher" placeholder='{"ok":true,"value":{"id":{"$match":"uuid"}}}'></textarea></label></div><pre id="result">Результат з’явиться тут.</pre></section><section class="panel"><h2>Load generator</h2><small>Три окремі режими. Спільний процес не вимірює capacity deployment.</small><div class="row"><label>Requests <input id="count" type="number" min="1" max="1000" value="100" style="width:95px"></label><label>Concurrency <input id="concurrency" type="number" min="1" max="25" value="5" style="width:85px"></label><select id="inputMode"><option value="fixed">Fixed input</option><option value="generated">Generated valid corpus</option></select><label>Duration ms<input type="number" id="duration" value="1000" min="1" max="30000"></label><label>Target RPS<input type="number" id="rps" value="100" min="1"></label><label>Ramp-up ms<input type="number" id="ramp" value="0" min="0"></label><label>Timeout ms<input type="number" id="loadTimeout" value="5000" min="1"></label><label>Max error rate<input id="maxErrors" type="number" value="0.01" step="0.01" min="0" max="1"></label><label>p95 budget ms<input id="p95budget" type="number" value="1000" min="0"></label><button id="load">Start load</button><button id="breaking">Find breaking point</button></div><pre id="loadResult">Вимірює поточну операцію й обраний транспорт.</pre></section><section class="panel"><h2>Failure injection</h2><select id="faultNode" aria-label="Fault node"></select><div class="row"><label>Latency ms <input id="latency" type="number" min="0" max="5000" value="100" style="width:90px"></label><label>Error rate <input id="errorRate" type="number" min="0" max="1" step="0.1" value="0" style="width:85px"></label><label>Timeout ms<input type="number" id="faultTimeout" value="0" min="0" max="5000"></label><label><input type="checkbox" id="unavailable">Unavailable</label><button id="inject">Apply</button><button id="clear">Clear</button></div><small>Для application-ресурсів оберіть явний effect-method. Timeout симулює відмову до виклику сервісу.</small><pre id="faults">{}</pre></section></div></div></main><script>
const $=id=>document.getElementById(id), pretty=x=>JSON.stringify(x,null,2), esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let graph,selected,last,live,generated=[],validCursor=0,invalidCursor=0;const activity=new Map();
async function api(path,body){const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(pretty(data));return data}
function payload(){return {operation:selected.id,input:JSON.parse($('input').value),mode:$('mode').value,authorization:$('auth').value}}
async function choose(id){selected=graph.nodes.find(n=>n.id===id);$('selectedTitle').textContent=id;$('contract').textContent=pretty({...selected,analysis:graph.analysis?.nodes.find(n=>n.id===id)});$('faultNode').value=id;if(selected.kind==='operation'){$('operation').value=id;generated=await api('generate',{operation:id});validCursor=invalidCursor=0;$('corpus').innerHTML=generated.map((c,i)=>'<option value=+i+>'+esc((c.valid?'✓ ':'✗ ')+c.label)+'</option>').join('');const valid=generated.filter(c=>c.valid);$('input').value=pretty(valid[(validCursor++)%Math.max(1,valid.length)]?.value??{})}else{$('operation').value='';$('input').value='{}'}last=undefined;draw()}
let renderedLayout;
const graphViewport = $('graph');
const zoom = $('graphZoom');
function resizeGraph() {
  $('graphZoomValue').textContent = zoom.value + '%';
  const svg = graphViewport.querySelector('svg');
  if (!svg) return;
  const scale = Number(zoom.value) / 100;
  svg.setAttribute('width', renderedLayout.width * scale);
  svg.setAttribute('height', renderedLayout.height * scale);
}
zoom.oninput = resizeGraph;
$('graphFit').onclick = () => {
  if (!renderedLayout?.nodes.length) return;
  const widthScale = (graphViewport.clientWidth - 2) / renderedLayout.width;
  const heightScale = (window.innerHeight * 0.65 - 2) / renderedLayout.height;
  zoom.value = Math.min(100, Math.floor(100 * Math.min(widthScale, heightScale)));
  resizeGraph();
  graphViewport.scrollTo(0, 0);
};

function renderGraph(layout) {
  renderedLayout = layout;
  if (!layout.nodes.length) {
    graphViewport.innerHTML = '<p class="muted">У цьому фільтрі немає вузлів.</p>';
    return;
  }

  const arrows = [['default', '#829bb3'], ['incoming', '#8fcaff'], ['outgoing', '#7ee2c0']];
  const markers = arrows.map(([name, color]) => '<marker id="arrow-' + name
    + '" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse">'
    + '<path d="M 0 0 L 10 5 L 0 10 Z" fill="' + color + '"/></marker>');
  const edges = layout.edges.map(edge => {
    const title = edge.from + ' → ' + edge.to + ' · ' + edge.kind + (edge.name ? ' · ' + edge.name : '');
    const path = edge.points.map(({x, y}, index) => (index ? 'L ' : 'M ') + x + ' ' + y).join(' ');
    return '<path class="edge' + (edge.kind === 'REMOTE_CALLS' ? ' remote' : '') + '" d="' + path + '">'
      + '<title>' + esc(title) + '</title></path>';
  });
  const nodes = layout.nodes.map(node => '<g class="node ' + esc(node.runtime ?? '')
    + '" data-id="' + esc(node.id) + '" tabindex="0" role="button" aria-label="' + esc(node.id)
    + '" transform="translate(' + node.x + ' ' + node.y + ')">'
    + '<rect width="' + node.width + '" height="' + node.height + '" rx="8"/>'
    + '<text x="12" y="21">' + esc(node.id) + '</text>'
    + '<text class="detail" x="12" y="39">' + esc([node.kind, node.scope].filter(Boolean).join(' · '))
    + '</text></g>');
  graphViewport.innerHTML = '<svg viewBox="0 0 ' + layout.width + ' ' + layout.height + '">'
    + '<defs>' + markers.join('') + '</defs>' + edges.join('') + nodes.join('') + '</svg>';
  graphViewport.querySelectorAll('.node').forEach(node => {
    node.onclick = () => choose(node.dataset.id);
    node.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(node.dataset.id);
      }
    };
  });
  resizeGraph();
}
function draw() {
  const layout = graph.layouts[$('runtimeFilter').value];
  if (layout !== renderedLayout) renderGraph(layout);

  const visibleSelection = layout.nodes.some(node => node.id === selected?.id) ? selected.id : undefined;
  graphViewport.querySelectorAll('.edge').forEach((path, index) => {
    const edge = layout.edges[index];
    const outgoing = edge.from === visibleSelection;
    const incoming = edge.to === visibleSelection;
    path.classList.toggle('outgoing', outgoing);
    path.classList.toggle('incoming', incoming && !outgoing);
    path.classList.toggle('muted', visibleSelection !== undefined && !incoming && !outgoing);
  });
  const metrics = new Map(live?.metrics.map(metric => [metric.id, metric]));
  graphViewport.querySelectorAll('.node').forEach((element, index) => {
    const node = layout.nodes[index];
    element.classList.toggle('active', (activity.get(node.id) ?? 0) > 0);
    element.classList.toggle('selected', node.id === visibleSelection);
    element.setAttribute('aria-pressed', String(node.id === visibleSelection));
    if (node.kind === 'operation') {
      const metric = metrics.get(node.id);
      element.querySelector('.detail').textContent =
        (metric?.rpm ?? 0) + ' rpm · ' + (metric?.p95 ?? 0).toFixed(1) + ' ms p95';
    }
  });
}
async function refresh(){live=await api('live');$('browserMetrics').textContent=pretty(live.browserMetrics??[]);const previous=$('interactionSelect').value;$('interactionSelect').innerHTML=(live.interactions??[]).map(i=>'<option>'+esc(i.traceId)+'</option>').join('');if((live.interactions??[]).some(i=>i.traceId===previous))$('interactionSelect').value=previous;showInteraction();$('metrics').innerHTML=live.metrics.map(m=>'<tr><td>'+esc(m.id)+'</td><td>'+m.active+' / '+m.rpm+'</td><td>'+m.p50.toFixed(2)+'</td><td>'+m.p95.toFixed(2)+'</td><td>'+m.errors+'</td></tr>').join('');$('faults').textContent=pretty(live.faults);const old=$('traceSelect').value;$('traceSelect').innerHTML=[...live.traces].reverse().map(t=>'<option value="'+esc(t.id)+'">'+esc(t.operation)+' · '+t.duration.toFixed(2)+' ms · '+esc(t.status)+'</option>').join('');if(live.traces.some(t=>t.id===old))$('traceSelect').value=old;showTrace();draw()}
function showInteraction(){const i=(live?.interactions??[]).find(i=>i.traceId===$('interactionSelect').value);if(i)$('interaction').textContent=pretty(i)}
function showTrace(){const t=live.traces.find(t=>t.id===$('traceSelect').value);if(t)$('trace').textContent=pretty(t)}
function action(id,fn){$(id).onclick=async()=>{$('message').textContent='';$(id).disabled=true;try{await fn();await refresh()}catch(e){$('message').textContent=e.message}finally{$(id).disabled=false}}}
action('run',async()=>{if(selected.kind!=='operation')throw Error('Оберіть operation');last=await api('run',payload());$('result').textContent=pretty(last)});action('valid',async()=>{const valid=generated.filter(c=>c.valid);$('input').value=pretty(valid[(validCursor++)%Math.max(1,valid.length)]?.value??{})});action('invalid',async()=>{const invalid=generated.filter(c=>!c.valid);$('input').value=pretty(invalid[(invalidCursor++)%Math.max(1,invalid.length)]?.value??null)});action('save',async()=>{if(last===undefined)throw Error('Спочатку виконайте operation');if($('mode').value!=='operation')throw Error('Зберігайте тест у режимі Operation');$('result').textContent=pretty(await api('test/save',{...payload(),expected:$('matcher').value.trim()?JSON.parse($('matcher').value):last,includeContext:$('saveContext').checked}))});action('tests',async()=>{$('result').textContent=pretty(await api('test/run',{}))});action('load',async()=>{$('loadResult').textContent='Running…';$('loadResult').textContent=pretty(await api('load',{...payload(),...loadOptions()}))});action('inject',async()=>{await api('fault',{node:$('faultNode').value,latencyMs:Number($('latency').value),errorRate:Number($('errorRate').value),timeoutMs:Number($('faultTimeout').value),unavailable:$('unavailable').checked})});action('clear',async()=>{await api('fault',{node:$('faultNode').value,clear:true})});function loadOptions(){return {count:Number($('count').value),concurrency:Number($('concurrency').value),durationMs:Number($('duration').value),targetRps:Number($('rps').value),rampUpMs:Number($('ramp').value),timeoutMs:Number($('loadTimeout').value),inputMode:$('inputMode').value}}
action('breaking',async()=>{$('loadResult').textContent=pretty(await api('breaking',{...payload(),...loadOptions(),initialRps:Number($('rps').value),steps:6,constraints:{maxErrorRate:Number($('maxErrors').value),p95Ms:Number($('p95budget').value)}}))});
action('exportTests',async()=>{const data=await api('test/export'+($('saveContext').checked?'?includeContext=1':''));const url=URL.createObjectURL(new Blob([pretty(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='arc-tests.json';a.click();URL.revokeObjectURL(url)});action('persistTests',async()=>{$('result').textContent=pretty(await api('test/persist',{}))});$('importTests').onchange=async()=>{try{const file=$('importTests').files[0];if(file)$('result').textContent=pretty(await api('test/import',{tests:JSON.parse(await file.text())}));}catch(e){$('message').textContent=e.message}};$('corpus').onchange=()=>{$('input').value=pretty(generated[Number($('corpus').value)].value)};
$('runtimeFilter').onchange=draw;$('interactionSelect').onchange=showInteraction;
$('operation').onchange=()=>choose($('operation').value);$('traceSelect').onchange=showTrace;
(async()=>{graph=await api('graph?layout=1');$('stats').innerHTML=[['Operations',graph.nodes.filter(n=>n.kind==='operation').length],['Resources',graph.nodes.filter(n=>n.kind==='resource').length],['HTTP routes',graph.routes.length],['Compiler','✓ valid']].map(([label,value])=>'<div class="stat"><small>'+label+'</small><b>'+value+'</b></div>').join('');$('operation').innerHTML=graph.nodes.filter(n=>n.kind==='operation').map(n=>'<option>'+esc(n.id)+'</option>').join('');$('faultNode').innerHTML=graph.nodes.map(n=>'<option>'+esc(n.id)+'</option>').join('');if(graph.nodes.length)await choose($('operation').value||graph.nodes[0].id);await refresh();const events=new EventSource('/api/events');events.onmessage=async message=>{const e=JSON.parse(message.data);if(e.type==='browser.event'){const b=e.data;if(b.type?.endsWith('.started'))activity.set(b.node,(activity.get(b.node)??0)+1);if(b.type?.endsWith('.finished'))activity.set(b.node,Math.max(0,(activity.get(b.node)??0)-1));if(b.type==='binding.updated'){activity.set(b.node,1);setTimeout(()=>{activity.set(b.node,0);draw()},150)}}if(e.type==='operation.started')activity.set(e.node,(activity.get(e.node)??0)+1);if(e.type==='operation.finished')activity.set(e.node,Math.max(0,(activity.get(e.node)??0)-1));if(e.type==='resource.opened')activity.set(e.node,1);if(e.type==='resource.closed')activity.set(e.node,0);if(e.type==='worker.state')activity.set(e.node,e.data?.running??0);if(e.type==='graph.updated')graph=await api('graph?layout=1');draw();};setInterval(()=>refresh().catch(e=>$('message').textContent=e.message),2000)})().catch(e=>$('message').textContent=e.message);
</script></html>`;
