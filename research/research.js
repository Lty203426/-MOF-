import { createScene } from './scene.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => Number(value).toLocaleString('zh-CN', {maximumSignificantDigits:7});
const state = {catalog:null, page:'overview', offset:0, query:'', filter:'', modelFilter:''};
let scene, viewVersion=0, selectionVersion=0, searchTimer, noticeTimer;
const size = 24;
const serviceKey = 'mof-studio:compute-service';

async function readJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资料读取失败（${response.status}）`);
  return response.json();
}
function notice(message) {
  $('#notice').textContent = message; $('#notice').style.display = 'block';
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').style.display='none'; }, 4500);
}
function storedService() {
  try { return localStorage.getItem(serviceKey) || 'http://127.0.0.1:8001'; }
  catch { return 'http://127.0.0.1:8001'; }
}
export function validateService(value) {
  const url = new URL(value.trim());
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTPS 服务地址，或本机 http://127.0.0.1:端口');
  }
  return url.href.replace(/\/$/, '');
}
// 计算服务端口被占用时会自动顺延（8001→8002…），因此不能写死 8001：
// 先试保存过的地址，再扫描 8001–8020。no-cors 模式下能连上即视为服务存在。
async function probeService(base) {
  try {
    const response = await fetch(base + '/api/integration/status', { mode: 'no-cors', signal: AbortSignal.timeout(1500) });
    return response.type === 'opaque' || response.ok;
  } catch { return false; }
}
async function findService() {
  const saved = storedService().replace(/\/$/, '');
  if (await probeService(saved)) return saved;
  for (let port = 8001; port <= 8020; port++) {
    const base = 'http://127.0.0.1:' + port;
    if (base === saved) continue;
    if (await probeService(base)) return base;
  }
  return null;
}
async function openCompute(page='predict', material=null) {
  notice('正在检测本机计算服务…');
  const base = await findService();
  if (!base) {
    notice('未检测到本机计算服务：请先在工程文件夹运行「启动AI实验室.cmd」，等服务启动后再试。');
    return;
  }
  try {
    const url = new URL(base + '/ai/');
    url.searchParams.set('page',page);
    if (material) url.searchParams.set('material',material);
    try { localStorage.setItem(serviceKey, base); } catch {}
    window.open(url.href, '_blank', 'noopener,noreferrer');
    notice('已打开本机计算服务：' + base);
  } catch (error) { notice(error.message); }
}
function pagination(total) {
  return `<div class="pagination"><button id="previous" ${state.offset===0?'disabled':''}>上一页</button><span>${total?state.offset+1:0}–${Math.min(state.offset+size,total)} / ${total.toLocaleString()}</span><button id="next" ${state.offset+size>=total?'disabled':''}>下一页</button></div>`;
}
function bindPagination(draw,total) {
  $('#previous').onclick=()=>{state.offset=Math.max(0,state.offset-size);draw();};
  $('#next').onclick=()=>{if(state.offset+size<total){state.offset+=size;draw();}};
}
function downloadJSON(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function overview() {
  const c=state.catalog;
  $('#content').innerHTML=`<div class="eyebrow">材料化学 · 计算化学 · 三维可视化 · 实验教学</div><h1>MOF 材料研究</h1>
    <div class="stats"><div><b>${c.materials.length.toLocaleString()}</b><span>公共结构记录</span></div><div><b>${c.tables.length}</b><span>可浏览 CSV</span></div><div><b>${c.gas_models+c.property_models}</b><span>已接入计算服务的模型</span></div><div><b>${c.archive_files.toLocaleString()}</b><span>本地完整归档资料</span></div></div>
    <div class="overview-columns"><section><h2>结构与原始数据</h2><p class="muted">晶体结构保留原 CIF 与 SHA-256。公共目录包含重复来源，${c.unique_cif_contents.toLocaleString()} 份不同 CIF 文件内容不等于独立材料数。</p><p>${c.parsed_structures.toLocaleString()} 条记录已通过当前解析器；未通过的记录保留原文件与具体原因。</p><button data-jump="library">进入材料库</button> <button data-jump="archive">查看数据表</button></section>
    <section><h2>真实 AI 计算</h2><p class="muted">SO₂、SF₆、C₇H₈、CH₄，以及形成能、绝对能量、带隙、费米能级、体积模量、剪切模量和泊松比。</p><p class="warning">气体模型的训练标签与单位待核验；晶体性质预训练模型在 MOF 上的适用域尚未验证。预测值不等同于实测。</p><button data-jump="predict">选择计算服务</button> <button data-jump="models">核对模型来源</button></section></div>
    <p class="source-note">${esc(c.note)} 原 HKUST-1 教学流程、自由实验台及评分继续使用现有仿真内核。当前网页版本 ${esc(c.version)}。</p>`;
  document.querySelectorAll('[data-jump]').forEach(button=>button.onclick=()=>navigate(button.dataset.jump));
}
function library() {
  $('#content').innerHTML=`<h1>材料库</h1><label class="search-label" for="material-query">材料名称、化学式或原始路径</label><div class="toolbar"><input id="material-query" type="search" value="${esc(state.query)}" placeholder="例如 HKUST、Cu、ABEXEM"><select id="material-filter" aria-label="结构状态"><option value="">全部结构</option><option value="parsed">可三维查看</option><option value="failed">待处理 CIF</option></select><button id="material-search">搜索</button><button id="export-catalog">导出当前目录</button></div><p id="material-count" class="caption"></p><div id="material-table"></div><section id="material-preview" aria-live="polite"></section>`;
  $('#material-filter').value=state.filter;
  let filtered=[];
  function draw() {
    const q=state.query.toLocaleLowerCase();
    filtered=state.catalog.materials.filter(m=>(`${m.name} ${m.path} ${m.formula||''}`.toLocaleLowerCase().includes(q))&&(!state.filter||(state.filter==='failed'?m.error:!m.error)));
    $('#material-count').textContent=`${filtered.length.toLocaleString()} 条来源记录 · 原始结构不代表本次虚拟合成产物`;
    $('#material-table').innerHTML=`<div class="table-scroll"><table><thead><tr><th>材料 / 来源</th><th>化学式</th><th>原子数</th><th>操作</th></tr></thead><tbody>${filtered.slice(state.offset,state.offset+size).map(m=>`<tr><td class="filename">${esc(m.name)}<small>${esc(m.path)}</small></td><td>${esc(m.formula||'待解析')}</td><td>${m.atom_count||'—'}</td><td><div class="row-actions"><button data-structure="${esc(m.id)}">${m.error?'查看原因':'查看结构'}</button><a class="action" href="${esc(m.url)}" download="${esc(m.name)}.cif">CIF</a><button data-predict="${esc(m.id)}">AI 预测 ↗</button></div></td></tr>`).join('')}</tbody></table>${filtered.length?'':'<p class="empty">没有匹配的材料</p>'}</div>${pagination(filtered.length)}`;
    bindPagination(draw,filtered.length);
    document.querySelectorAll('[data-structure]').forEach(button=>button.onclick=()=>selectMaterial(button.dataset.structure));
    document.querySelectorAll('[data-predict]').forEach(button=>button.onclick=()=>openCompute('predict',button.dataset.predict));
  }
  function search(){state.query=$('#material-query').value.trim();state.filter=$('#material-filter').value;state.offset=0;draw();}
  $('#material-search').onclick=search;$('#material-filter').onchange=search;
  $('#material-query').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,220);};
  $('#material-query').onkeydown=event=>{if(event.key==='Enter'){clearTimeout(searchTimer);search();}};
  $('#export-catalog').onclick=()=>downloadJSON('MOF-材料目录.json',filtered);
  draw();
}
async function selectMaterial(id) {
  const m=state.catalog.materials.find(item=>item.id===id);
  if(!m)return;
  const version=++selectionVersion, pageVersion=viewVersion;
  scene?.dispose();scene=null;
  const preview=$('#material-preview');
  preview.innerHTML=`<div class="workspace"><div><h2>${esc(m.name)}</h2><div class="viewer" id="structure-canvas"><p class="loading">正在读取晶体坐标…</p></div><div id="viewer-tools" class="viewer-tools"></div></div><div class="details"><h3>结构记录</h3><p class="caption filename">${esc(m.path)}</p><div id="structure-details"></div><p class="caption">原文件 SHA-256</p><code>${esc(m.sha256)}</code><p id="atom-details" class="caption"></p></div></div>`;
  preview.scrollIntoView({behavior:'smooth',block:'start'});
  if(m.error){$('#structure-canvas').innerHTML=`<p class="warning">${esc(m.error)}</p>`;return;}
  try {
    const data=await readJSON(m.structure_url);
    if(version!==selectionVersion||pageVersion!==viewVersion)return;
    $('#structure-canvas').innerHTML='';
    scene=createScene($('#structure-canvas'),data,false,(atom,index)=>{$('#atom-details').textContent=`原子 ${index+1} · ${atom.element} · 笛卡尔坐标 (${atom.position.map(v=>v.toFixed(4)).join(', ')}) Å`;});
    $('#structure-details').innerHTML=`<dl><dt>化学式</dt><dd>${esc(data.formula)}</dd><dt>原子数</dt><dd>${data.atom_count}</dd><dt>晶胞边长</dt><dd>${data.abc.map(fmt).join(' / ')} Å</dd><dt>晶胞角度</dt><dd>${data.angles.map(fmt).join(' / ')} °</dd><dt>体积</dt><dd>${fmt(data.volume)} Å³</dd></dl><p class="warning">显示键为几何推定的晶胞内连线，不代表完整周期化学键；模型图单独按周期邻居构建。</p>${data.warnings.map(w=>`<p class="caption">${esc(w)}</p>`).join('')}`;
    $('#viewer-tools').innerHTML='<button data-view="reset" title="复位视角">复位</button><button data-view="toggleSpin" aria-pressed="false">自动旋转</button><button data-view="toggleCell" aria-pressed="true">晶胞</button><button data-view="toggleStyle" aria-pressed="false">空间填充</button>';
    document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{scene?.[button.dataset.view]();if(button.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));});
  }catch(error){if(version===selectionVersion&&pageVersion===viewVersion)$('#structure-canvas').innerHTML=`<p class="error">${esc(error.message)}</p>`;}
}
function archive() {
  $('#content').innerHTML=`<h1>原始数据表</h1><p class="warning">保留源文件行序和原数值；不自动推断表头、单位或实测身份。id_prop.csv 可能含占位值，test_results.csv 可能是历史模型输出。</p><label class="search-label" for="table-query">原始路径或文件名</label><div class="toolbar"><input id="table-query" type="search" value="${esc(state.query)}" placeholder="搜索 CSV"><button id="table-search">搜索</button></div><div id="table-list"></div><section id="table-preview" aria-live="polite"></section>`;
  function draw(){
    const filtered=state.catalog.tables.filter(t=>t.path.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
    $('#table-list').innerHTML=`<div class="table-scroll"><table><thead><tr><th>原始路径</th><th>文件大小</th><th>操作</th></tr></thead><tbody>${filtered.slice(state.offset,state.offset+size).map(t=>`<tr><td class="filename">${esc(t.path)}<small>${esc(t.sha256)}</small></td><td>${fmt(t.bytes/1024)} KB</td><td><div class="row-actions"><button data-table="${t.id}">查看数据</button><a class="action" href="${t.url}" download="${esc(t.name)}.csv">下载 CSV</a></div></td></tr>`).join('')}</tbody></table>${filtered.length?'':'<p class="empty">没有匹配的数据表</p>'}</div>${pagination(filtered.length)}`;
    bindPagination(draw,filtered.length);
    document.querySelectorAll('[data-table]').forEach(button=>button.onclick=()=>showTable(button.dataset.table));
  }
  function search(){state.query=$('#table-query').value.trim();state.offset=0;draw();}
  $('#table-search').onclick=search;$('#table-query').onkeydown=event=>{if(event.key==='Enter')search();};draw();
}
async function showTable(id) {
  const entry=state.catalog.tables.find(t=>t.id===id), version=++selectionVersion, pageVersion=viewVersion;
  const preview=$('#table-preview');preview.innerHTML='<p class="loading">正在读取原始数据…</p>';
  try{
    const data=await readJSON(entry.table_url);
    if(version!==selectionVersion||pageVersion!==viewVersion)return;
    let offset=0;
    function draw(){
      const width=Math.min(data.column_count,data.column_limit);
      preview.innerHTML=`<div class="table-preview"><h2 class="filename">${esc(entry.path)}</h2><p class="caption">${data.row_count.toLocaleString()} 行 / ${data.column_count} 列；浏览器预览最多前 ${data.column_limit} 列、每格 500 字符，原 CSV 保持完整。</p><h3>逐列有限数值统计</h3><div class="table-scroll"><table><thead><tr><th>列</th><th>数量</th><th>最小值</th><th>均值</th><th>最大值</th></tr></thead><tbody>${data.numeric_summary.map((s,i)=>`<tr><td>第 ${i+1} 列</td><td>${s.count}</td><td>${s.min===null?'—':fmt(s.min)}</td><td>${s.mean===null?'—':fmt(s.mean)}</td><td>${s.max===null?'—':fmt(s.max)}</td></tr>`).join('')}</tbody></table></div><h3>原始行</h3><div class="table-scroll"><table><thead><tr><th>行号</th>${Array.from({length:width},(_,i)=>`<th>第 ${i+1} 列</th>`).join('')}<th>关联结构</th></tr></thead><tbody>${data.rows.slice(offset,offset+30).map(row=>`<tr><td>${row.row}</td>${Array.from({length:width},(_,i)=>`<td>${esc(row.values[i])}</td>`).join('')}<td>${row.material_id?`<button data-row-material="${esc(row.material_id)}">查看结构</button>`:'—'}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><button id="rows-prev" ${offset===0?'disabled':''}>上一页</button><span>${data.row_count?offset+1:0}–${Math.min(offset+30,data.row_count)} / ${data.row_count}</span><button id="rows-next" ${offset+30>=data.row_count?'disabled':''}>下一页</button></div></div>`;
      $('#rows-prev').onclick=()=>{offset=Math.max(0,offset-30);draw();};$('#rows-next').onclick=()=>{offset+=30;draw();};
      document.querySelectorAll('[data-row-material]').forEach(button=>button.onclick=()=>{const material=button.dataset.rowMaterial;navigate('library');selectMaterial(material);});
    }
    draw();preview.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){if(version===selectionVersion&&pageVersion===viewVersion)preview.innerHTML=`<p class="error">${esc(error.message)}</p>`;}
}
function models() {
  $('#content').innerHTML=`<h1>模型清单</h1><p>17 份原始权重：4 个气体模型与 7 个性质模型已接入本地真实推理，其余 6 份保留原件待核验。</p><p class="warning">气体输出使用待核验的训练标签原始尺度；模量为 log(GPa)。费米能级单位沿用随附文档并待核验。性质模型来源为 Materials Project / CGCNN，MOF 适用域未验证。</p><div class="table-scroll"><table><thead><tr><th>原始文件</th><th>目标</th><th>状态</th><th>SHA-256</th></tr></thead><tbody>${state.catalog.models.map(m=>`<tr><td class="filename">${esc(m.path)}</td><td>${esc(m.target||'待核验')}</td><td><span class="badge ${m.enabled?'':'pending'}">${m.enabled?'计算服务已接入':'待核验'}</span><small>${esc(m.note)}</small></td><td class="filename"><code>${esc(m.sha256)}</code></td></tr>`).join('')}</tbody></table></div><p class="source-note">模型权重原件保存在本地完整工程。网站只展示来源和接入状态，不在浏览器中伪造模型输出。</p><button id="models-compute">打开模型计算</button>`;
  $('#models-compute').onclick=()=>openCompute('models');
}
function service(page='predict') {
  $('#content').innerHTML=`<div class="eyebrow">CGCNN · 本地 CPU / 已部署的 HTTPS 服务</div><h1>AI 计算服务</h1><p>当前网站可独立浏览材料和数据；模型推理、批量筛选、账户与预测历史由计算服务提供。</p><p id="service-status" class="caption" role="status">正在检测本机计算服务…</p><label for="service-url">计算服务地址</label><form id="service-form" class="service-form"><input id="service-url" type="url" required value="${esc(storedService())}" placeholder="http://127.0.0.1:8001"><button type="submit">保存地址</button></form><div class="service-actions"><button id="launch-predict">气体预测 ↗</button><button id="launch-properties">材料性质 ↗</button><button id="launch-screening">批量筛选 ↗</button><button id="launch-history">预测历史 ↗</button></div><ol class="steps"><li>在桌面「MOF-Studio_交互升级_试剂瓶搅拌滴定」文件夹运行「启动AI实验室.cmd」。</li><li>使用启动后显示的实际地址。本机默认从 8001 端口启动，端口占用时自动选择下一可用端口；本页会自动探测 8001–8020。</li><li>在计算工作台登录，选择结构与模型后提交；实验快照与结果关联保存在计算服务中。</li></ol><p class="warning">GitHub Pages 不运行 Python / PyTorch。此页面不会在计算服务未启动时显示预测结果。HTTPS 网页通过新标签打开本机服务，不嵌入不安全的 HTTP 计算页面。</p><p class="source-note">使用远程 HTTPS 服务时，材料上传与实验同步发生在该服务内；保存地址不会自动上传当前实验记录。</p>`;
  $('#service-form').onsubmit=event=>{event.preventDefault();try{const value=validateService($('#service-url').value);localStorage.setItem(serviceKey,value);$('#service-url').value=value;notice('计算服务地址已保存');}catch(error){notice(error.message);}};
  findService().then(base=>{
    const el=$('#service-status');
    if(!el)return;
    if(base){el.textContent='✓ 已检测到本机计算服务：'+base;$('#service-url').value=base;try{localStorage.setItem(serviceKey,base);}catch{}}
    else if(location.protocol==='https:'){el.textContent='✗ 未自动检测到本机计算服务。HTTPS 网页可能被浏览器限制探测本机端口，请先运行「启动AI实验室.cmd」，再把启动后显示的地址填入下方。';}
    else{el.textContent='✗ 未检测到本机计算服务（已扫描 8001–8020 端口）。请先运行「启动AI实验室.cmd」。';}
  });
  for(const [button,target] of [['predict','predict'],['properties','properties'],['screening','screening'],['history','history']])$('#launch-'+button).onclick=()=>openCompute(target);
}
function navigate(page) {
  clearTimeout(searchTimer);scene?.dispose();scene=null;viewVersion++;selectionVersion++;
  state.page=['overview','library','archive','models','predict','properties','screening','history','linked'].includes(page)?page:'overview';
  state.offset=0;state.query='';state.filter='';
  const active=['properties','screening','history','linked'].includes(state.page)?'predict':state.page;
  document.querySelectorAll('[data-page]').forEach(button=>{if(button.dataset.page===active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  const url=new URL(location.href);url.searchParams.set('page',state.page);history.replaceState(null,'',url);
  ({overview,library,archive,models}[state.page]||service)(state.page);
  if(window.parent!==window)window.parent.postMessage({type:'mof-ai:page',page:state.page},location.origin);
}
$('#compute-entry').onclick=()=>openCompute();
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>navigate(button.dataset.page));
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='mof-ai:navigate'&&state.catalog)navigate(event.data.page);});
window.addEventListener('pagehide',()=>{scene?.dispose();clearTimeout(searchTimer);clearTimeout(noticeTimer);});
try{
  state.catalog=await readJSON('catalog.json?v=20261106.1');
  $('#content').setAttribute('aria-busy','false');
  navigate(new URLSearchParams(location.search).get('page')||'overview');
}catch(error){$('#content').setAttribute('aria-busy','false');$('#content').innerHTML=`<h1>研究目录暂不可用</h1><p class="error">${esc(error.message)}</p><button id="reload">重新加载</button>`;$('#reload').onclick=()=>location.reload();}
