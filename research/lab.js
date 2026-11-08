/*
 * lab.js — AI 实验室（气体吸附 + 材料性质预测）
 *
 * 设计目标：打开公网网址 → 登录 → 立即预测。
 * 推理在浏览器内完成（CGCNN 权重随站点发布），不依赖本机 Python 服务、
 * 不依赖端口探测，因此换任何一台电脑/手机打开都不会出现“功能打不开”。
 */

import { CgcnnEngine } from './cgcnn-engine.js';

const USER_KEY = 'mof-studio:users:v1';
const SESSION_KEY = 'mof-studio:session:v1';
const RECORD_KEY = 'mof-studio:lab-records:v1';
const DEMO_USER = 'report.demo';
const DEMO_PASS = 'MofStudio2026';
const FEATURED_FALLBACK = ['HKUST-1', 'MOF-5', 'Uio-66-NH2', 'MOF-177'];

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (value, digits = 4) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 1e5) return number.toExponential(3);
  return number.toLocaleString('zh-CN', { maximumSignificantDigits: digits + 1 });
};
const readStore = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
const writeStore = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

/* ---------------- 本地账户（仅保存在本浏览器，用于隔离实验记录） ---------------- */

async function derive(password, salt) {
  if (globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  const text = salt + '|' + password;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return 'fnv' + (hash >>> 0).toString(16);
}

const auth = {
  users() { return readStore(USER_KEY, {}); },
  session() {
    const session = readStore(SESSION_KEY, null);
    if (!session || !session.user) return null;
    return this.users()[session.user] ? session : null;
  },
  async register(username, password) {
    const name = String(username || '').trim();
    if (!/^[\w\u4e00-\u9fa5.\-]{2,20}$/.test(name)) throw new Error('用户名为 2–20 位字母、数字、汉字或 . _ -');
    if (String(password || '').length < 6) throw new Error('密码至少 6 位');
    const users = this.users();
    if (users[name]) throw new Error('该用户名已存在，请直接登录');
    const salt = Math.random().toString(36).slice(2, 10);
    users[name] = { salt, hash: await derive(password, salt), created: new Date().toISOString() };
    writeStore(USER_KEY, users);
    this.start(name);
    return name;
  },
  async login(username, password) {
    const name = String(username || '').trim();
    const users = this.users();
    const record = users[name];
    if (!record) throw new Error('没有这个用户名，请先注册');
    if (await derive(password, record.salt) !== record.hash) throw new Error('密码不正确');
    this.start(name);
    return name;
  },
  start(name) { writeStore(SESSION_KEY, { user: name, at: Date.now() }); },
  logout() { try { localStorage.removeItem(SESSION_KEY); } catch {} },
  async demo() {
    const users = this.users();
    if (!users[DEMO_USER]) {
      const salt = Math.random().toString(36).slice(2, 10);
      users[DEMO_USER] = { salt, hash: await derive(DEMO_PASS, salt), created: new Date().toISOString() };
      writeStore(USER_KEY, users);
    }
    this.start(DEMO_USER);
    return DEMO_USER;
  },
};

function records(user) {
  const all = readStore(RECORD_KEY, {});
  return Array.isArray(all[user]) ? all[user] : [];
}
function saveRecord(user, record) {
  const all = readStore(RECORD_KEY, {});
  const list = Array.isArray(all[user]) ? all[user] : [];
  list.unshift(record);
  all[user] = list.slice(0, 60);
  return writeStore(RECORD_KEY, all);
}

/* ---------------- 推理调度（多个 Worker 并行，失败则退回主线程） ---------------- */

function createPool(size) {
  const workers = [];
  for (let i = 0; i < size; i++) {
    try { workers.push(new Worker(new URL('./cgcnn-worker.js', import.meta.url), { type: 'module' })); }
    catch { break; }
  }
  return workers;
}

async function runOnMainThread(structure, models, onResult, onStatus) {
  const engine = await CgcnnEngine.load('./model/');
  await engine.loadEmbedding();
  onStatus('正在构建周期邻接图…');
  const graph = engine.buildGraph(structure);
  for (const id of models) {
    onStatus('正在推理 ' + id);
    await new Promise(resolve => setTimeout(resolve, 0));
    onResult(id, await engine.predict(id, graph));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function runPrediction(structure, modelIds, { onResult, onStatus, onDone, onError }) {
  const size = Math.max(1, Math.min(3, navigator.hardwareConcurrency || 2));
  let workers = createPool(size);
  if (!workers.length) {
    try { await runOnMainThread(structure, modelIds, onResult, onStatus); onDone(); }
    catch (error) { onError(error.message || String(error)); }
    return () => {};
  }
  const chunks = Array.from({ length: workers.length }, () => []);
  modelIds.forEach((id, index) => chunks[index % workers.length].push(id));
  let remaining = modelIds.length;
  let failed = null;
  workers.forEach((worker, index) => {
    const tag = 'w' + index;
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'result') {
        onResult(message.modelId, message.value);
        remaining--;
        onStatus('已完成 ' + (modelIds.length - remaining) + ' / ' + modelIds.length + ' 个模型');
        if (remaining === 0 && !failed) { onDone(); workers.forEach(item => item.terminate()); }
      } else if (message.type === 'status') onStatus(message.text);
      else if (message.type === 'error') {
        if (!failed) { failed = message.message; onError(message.message); }
        workers.forEach(item => item.terminate());
      }
    };
    worker.onerror = event => {
      if (failed) return;
      failed = event.message || '推理线程异常';
      onError(failed);
      workers.forEach(item => item.terminate());
    };
    worker.postMessage({ type: 'run', tag, structure, models: chunks[index], base: './model/' });
  });
  return () => workers.forEach(item => item.terminate());
}

/* ---------------- 界面 ---------------- */

export function mountLab(container, options = {}) {
  const catalog = options.catalog;
  const notice = options.notice || (() => {});
  let session = auth.session();
  let engine = null;
  let manifest = null;
  let selectedMaterial = null;
  let structureCache = new Map();
  let running = false;
  let lastValues = null;
  let initialPick = options.materialId || null;

  const materials = catalog?.materials || [];
  let featured = FEATURED_FALLBACK
    .map(name => materials.find(m => m.name && m.name.toLowerCase() === name.toLowerCase()))
    .filter(Boolean);
  // 精选结构优先用预置演示清单（11 个经典 MOF，数值已与桌面版核对一致）
  fetch('demo-predictions.json').then(r => r.ok ? r.json() : null).then(data => {
    const picks = (data?.materials || [])
      .map(item => materials.find(m => m.id === item.id))
      .filter(Boolean);
    if (picks.length && container.querySelector('#lab-featured')) {
      featured = picks;
      const box = container.querySelector('#lab-featured');
      if (box) renderFeatured();
      if (!selectedMaterial && featured[0]) choose(featured[0]);
    }
  }).catch(() => {});

  render();

  function render() {
    if (!session) { container.innerHTML = loginView(); bindLogin(); return; }
    container.innerHTML = labView();
    bindLab();
    loadManifest().catch(error => setStatus('模型清单读取失败：' + error.message, true));
    renderFeatured();
    renderHistory();
    if (initialPick) { const found = materials.find(m => m.id === initialPick); if (found) choose(found); initialPick = null; }
    else if (featured[0]) choose(featured[0]);
  }

  function loginView() {
    const users = Object.keys(auth.users());
    return `<div class="lab-login">
      <div class="lab-login-card">
        <div class="lab-eyebrow">MOF STUDIO · AI 实验室</div>
        <h1>登录后即可直接做气体吸附与性质预测</h1>
        <p class="lab-lead">模型在本机浏览器内运行，登录只用于保存你的实验记录。打开网址、登录、点「开始预测」，不需要安装任何软件，也不需要启动本地服务。</p>
        <form id="lab-login-form" autocomplete="on">
          <label>用户名<input id="lab-user" name="username" autocomplete="username" required minlength="2" placeholder="例如 report.demo"></label>
          <label>密码<input id="lab-pass" name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="至少 6 位"></label>
          <div class="lab-login-actions">
            <button type="submit" class="primary">登录</button>
            <button type="button" id="lab-register">注册新账户</button>
          </div>
        </form>
        <button type="button" id="lab-demo" class="lab-demo">演示账户一键进入（${DEMO_USER}）</button>
        <p id="lab-login-msg" class="lab-msg" role="status"></p>
        <p class="lab-fine">账户与实验记录仅保存在本浏览器（localStorage），不会上传到任何服务器；换电脑或清除浏览器数据后需要重新注册。${users.length ? '本机已有账户：' + esc(users.slice(0, 6).join('、')) : ''}</p>
      </div>
      <div class="lab-login-side">
        <h2>已接入的模型</h2>
        <ul>
          <li><b>4 个气体模型</b>：SO₂、SF₆、C₇H₈、CH₄（CGCNN 回归）</li>
          <li><b>7 个性质模型</b>：形成能、绝对能量、带隙、费米能级、体积模量、剪切模量、泊松比</li>
          <li><b>5,867 条公共结构</b>：直接搜索材料名或化学式即可预测</li>
        </ul>
        <p class="lab-fine">权重来自项目原始 PyTorch checkpoint，逐层等价复现在浏览器中执行；同一结构的结果与桌面版计算服务一致（差异 &lt; 1e-5）。</p>
      </div>
    </div>`;
  }

  function bindLogin() {
    const message = text => { const el = container.querySelector('#lab-login-msg'); if (el) el.textContent = text || ''; };
    container.querySelector('#lab-login-form').onsubmit = async event => {
      event.preventDefault();
      const user = container.querySelector('#lab-user').value;
      const pass = container.querySelector('#lab-pass').value;
      try {
        await auth.login(user, pass);
        session = auth.session(); render();
      } catch (error) { message(error.message); }
    };
    container.querySelector('#lab-register').onclick = async () => {
      const user = container.querySelector('#lab-user').value;
      const pass = container.querySelector('#lab-pass').value;
      try { await auth.register(user, pass); session = auth.session(); render(); }
      catch (error) { message(error.message); }
    };
    container.querySelector('#lab-demo').onclick = async () => {
      try { await auth.demo(); session = auth.session(); render(); }
      catch (error) { message(error.message); }
    };
  }

  function labView() {
    return `<div class="lab">
      <div class="lab-head">
        <div>
          <div class="lab-eyebrow">CGCNN · 浏览器内真实推理</div>
          <h1>AI 实验室：气体吸附与材料性质预测</h1>
          <p class="lab-lead">选结构 → 选模型 → 预测。全部计算在你打开的这台电脑/手机上完成，结果与桌面版计算服务一致。</p>
        </div>
        <div class="lab-user">
          <span>已登录 <b>${esc(session.user)}</b></span>
          <button type="button" id="lab-logout">退出</button>
        </div>
      </div>
      <div class="lab-grid">
        <aside class="lab-setup">
          <h2>1. 选择晶体结构</h2>
          <input id="lab-search" type="search" placeholder="搜索材料名 / 化学式，共 ${materials.length.toLocaleString()} 条">
          <div id="lab-featured" class="lab-chips"></div>
          <div id="lab-results" class="lab-results" hidden></div>
          <div id="lab-selected" class="lab-selected">尚未选择结构</div>
          <h2>2. 选择模型</h2>
          <div id="lab-models" class="lab-models"><p class="lab-fine">正在读取模型清单…</p></div>
          <button type="button" id="lab-run" class="primary lab-run">开始预测</button>
          <p id="lab-status" class="lab-status" role="status"></p>
        </aside>
        <main class="lab-result">
          <div id="lab-output" class="lab-output"><p class="lab-fine">选择结构后点击「开始预测」，这里会显示每个模型的预测值与说明。</p></div>
        </main>
      </div>
    </div>`;
  }

  function bindLab() {
    container.querySelector('#lab-logout').onclick = () => { auth.logout(); session = null; render(); };
    container.querySelector('#lab-search').oninput = event => search(event.target.value);
    container.querySelector('#lab-run').onclick = run;
  }

  async function loadManifest() {
    if (manifest) { renderModels(); return manifest; }
    engine = await CgcnnEngine.load('./model/');
    manifest = engine.manifest;
    renderModels();
    return manifest;
  }

  function renderModels() {
    const box = container.querySelector('#lab-models');
    if (!box || !manifest) return;
    const gas = manifest.models.filter(model => model.kind === 'gas');
    const property = manifest.models.filter(model => model.kind === 'property');
    box.innerHTML = `<div class="lab-group"><div class="lab-group-title">气体吸附（4）</div>${gas.map(model => row(model, true)).join('')}</div>
      <div class="lab-group"><div class="lab-group-title">材料性质（7）</div>${property.map(model => row(model, false)).join('')}</div>`;
    box.querySelectorAll('input').forEach(input => { input.onchange = updateCount; });
    updateCount();
    function row(model, checked) {
      return `<label class="lab-check"><input type="checkbox" value="${esc(model.id)}" ${checked ? 'checked' : ''}><span>${esc(model.label)}<small>${esc(model.name)}${model.unit ? ' · ' + esc(model.unit) : ''}</small></span></label>`;
    }
  }

  function selectedModels() {
    return [...container.querySelectorAll('#lab-models input:checked')].map(input => input.value);
  }

  function updateCount() {
    const button = container.querySelector('#lab-run');
    if (button && !running) button.textContent = '开始预测（' + selectedModels().length + ' 个模型）';
  }

  function renderFeatured() {
    const box = container.querySelector('#lab-featured');
    if (!box) return;
    const picks = featured.length ? featured : materials.slice(0, 6);
    box.innerHTML = picks.map(item => `<button type="button" data-pick="${esc(item.id)}">${esc(item.name)}</button>`).join('');
    box.querySelectorAll('[data-pick]').forEach(button => {
      button.onclick = () => { const found = materials.find(m => m.id === button.dataset.pick); if (found) choose(found); };
    });
  }

  function search(query) {
    const box = container.querySelector('#lab-results');
    const text = String(query || '').trim().toLowerCase();
    if (!text) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = materials.filter(item => (`${item.name} ${item.formula || ''} ${item.path || ''}`).toLowerCase().includes(text)).slice(0, 30);
    box.hidden = false;
    box.innerHTML = hits.length
      ? hits.map(item => `<button type="button" data-id="${esc(item.id)}"><b>${esc(item.name)}</b><small>${esc(item.formula || '待解析')} · ${item.atom_count || '—'} 原子</small></button>`).join('')
      : '<p class="lab-fine">没有匹配的材料，试试化学式片段，例如 Cu、ZIF、UiO。</p>';
    box.querySelectorAll('[data-id]').forEach(button => {
      button.onclick = () => {
        const found = materials.find(m => m.id === button.dataset.id);
        if (found) { choose(found); box.hidden = true; container.querySelector('#lab-search').value = ''; }
      };
    });
  }

  async function choose(material) {
    selectedMaterial = material;
    const box = container.querySelector('#lab-selected');
    if (!box) return; // 界面已切换（如退出登录）时忽略迟到的异步回调
    box.innerHTML = `<div><b>${esc(material.name)}</b><small>${esc(material.formula || '待解析')} · ${material.atom_count || '—'} 个原子 · ${esc(material.path || '')}</small></div>`;
    setStatus('');
  }

  function setStatus(text, isError = false) {
    const el = container.querySelector('#lab-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  async function structureFor(material) {
    if (structureCache.has(material.id)) return structureCache.get(material.id);
    if (!material.structure_url) throw new Error('该记录没有可用的结构文件（CIF 解析未完成）');
    let response = null, lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await fetch(material.structure_url);
        if (response.ok) break;
        lastError = new Error('HTTP ' + response.status);
      } catch (error) { lastError = error; }
      response = null;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!response || !response.ok) throw new Error('结构文件读取失败：' + (lastError?.message || response?.status));
    const sheet = await response.json();
    structureCache.set(material.id, sheet);
    return sheet;
  }

  async function run() {
    if (running) return;
    const models = selectedModels();
    if (!selectedMaterial) { setStatus('请先选择一个晶体结构', true); return; }
    if (!models.length) { setStatus('请至少选择一个模型', true); return; }
    running = true;
    const button = container.querySelector('#lab-run');
    button.disabled = true;
    button.textContent = '正在推理…';
    const output = container.querySelector('#lab-output');
    output.innerHTML = `<div class="lab-progress"><div class="lab-spinner"></div><p>正在准备结构与模型…</p><p class="lab-fine">首次运行需要下载对应模型权重（每个约 0.4–0.5 MB），之后浏览器会缓存。</p><div id="lab-live" class="lab-live"></div></div>`;
    setStatus('准备中…');
    const started = performance.now();
    try {
      const sheet = await structureFor(selectedMaterial);
      const values = new Map();
      const p = output.querySelector('p');
      const render = () => {
        const done = values.size;
        if (p) p.textContent = `已完成 ${done} / ${models.length} 个模型…`;
      };
      await new Promise((resolve, reject) => {
        runPrediction(sheet, models, {
          onResult(id, value) {
            values.set(id, value);
            render();
            const live = output.querySelector('#lab-live');
            const model = engine.model(id);
            if (live && model) {
              const row = document.createElement('div');
              row.className = 'lab-live-row';
              row.innerHTML = `<span>${esc(model.label)}</span><b>${fmt(value)}</b><small>${esc(model.unit || '')}</small>`;
              live.append(row);
            }
          },
          onStatus(text) { setStatus(text); },
          onDone: resolve,
          onError: reject,
        }).catch(reject);
      });
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      lastValues = values;
      renderResults(values, models, Number(seconds));
      setStatus(`预测完成：${models.length} 个模型，用时 ${seconds} 秒`);
      const record = {
        id: String(Date.now()),
        at: new Date().toISOString(),
        material: { id: selectedMaterial.id, name: selectedMaterial.name, formula: selectedMaterial.formula || '', atoms: selectedMaterial.atom_count || null },
        seconds: Number(seconds),
        values: Object.fromEntries(values),
      };
      const saved = saveRecord(session.user, record);
      renderHistory();
      if (!saved) notice('实验记录保存失败：浏览器存储空间不足');
    } catch (error) {
      output.innerHTML = `<p class="lab-error">预测没有完成：${esc(error.message || error)}。请检查网络后重试；如果一直失败，换用 Chrome / Edge 浏览器打开本页。</p>`;
      setStatus('预测失败', true);
    } finally {
      running = false;
      button.disabled = false;
      updateCount();
    }
  }

  function renderResults(values, models, seconds) {
    const output = container.querySelector('#lab-output');
    const gas = models.filter(id => engine.model(id)?.kind === 'gas');
    const properties = models.filter(id => engine.model(id)?.kind === 'property');
    const gasRows = gas.map(id => {
      const model = engine.model(id);
      return `<tr><td>${esc(model.label)}<small>${esc(model.name)}</small></td><td class="num">${fmt(values.get(id))}</td><td>${esc(model.unit || '—')}</td></tr>`;
    }).join('');
    const propertyRows = properties.map(id => {
      const model = engine.model(id);
      return `<tr><td>${esc(model.label)}</td><td class="num">${fmt(values.get(id))}</td><td>${esc(model.unit || '—')}</td></tr>`;
    }).join('');
    const best = gas.length ? gas.reduce((a, b) => (Number(values.get(b)) > Number(values.get(a)) ? b : a)) : null;
    const material = selectedMaterial;
    output.innerHTML = `<div class="lab-report">
      <div class="lab-report-head">
        <div><div class="lab-eyebrow">预测结果</div><h2>${esc(material.name)}</h2>
        <p class="lab-fine">${esc(material.formula || '')}${material.atom_count ? ' · ' + material.atom_count + ' 个原子' : ''} · ${models.length} 个模型 · ${seconds} 秒</p></div>
        <button type="button" id="lab-download">导出 CSV</button>
      </div>
      ${gasRows ? `<h3>气体吸附相关预测</h3><div class="table-scroll"><table><thead><tr><th>气体</th><th>预测值</th><th>单位</th></tr></thead><tbody>${gasRows}</tbody></table></div>
        ${best ? `<p class="lab-fine">本结构在所选气体中数值最高的是 ${esc(engine.model(best).label)}（${fmt(values.get(best))}）。模型输出为训练标签原始尺度，只可用于同批次横向比较。</p>` : ''}` : ''}
      ${propertyRows ? `<h3>材料性质预测</h3><div class="table-scroll"><table><thead><tr><th>性质</th><th>预测值</th><th>单位</th></tr></thead><tbody>${propertyRows}</tbody></table></div>` : ''}
      <p class="lab-warning">预测值由 CGCNN 模型在当前结构上直接推理得到，不等同于实验测量；气体模型的单位与测试条件、晶体性质模型对 MOF 的适用域均待核验，不构成材料设计依据。</p>
    </div>`;
    output.querySelector('#lab-download').onclick = () => {
      const rows = [['材料', '化学式', '原子数', '模型', '类型', '预测值', '单位', '时间']];
      const time = new Date().toISOString();
      models.forEach(id => {
        const model = engine.model(id);
        rows.push([material.name, material.formula || '', material.atom_count || '', model.name, model.kind === 'gas' ? '气体吸附' : '材料性质', values.get(id), model.unit || '', time]);
      });
      const csv = '\ufeff' + rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url; link.download = `MOF预测-${material.name}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
  }

  function renderHistory() {
    const host = container.querySelector('#lab-output');
    const list = records(session.user);
    let panel = container.querySelector('#lab-history');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'lab-history';
      panel.className = 'lab-history';
      const grid = container.querySelector('.lab-grid');
      if (grid) grid.after(panel);
    }
    if (!list.length) { panel.innerHTML = `<h2>实验记录</h2><p class="lab-fine">还没有记录。完成一次预测后会自动保存在这里（最多保留 60 条）。</p>`; return; }
    panel.innerHTML = `<h2>实验记录 <small>${list.length} 条 · 仅本浏览器可见</small></h2>
      <div class="table-scroll"><table><thead><tr><th>时间</th><th>结构</th><th>模型数</th><th>用时</th><th>操作</th></tr></thead><tbody>
      ${list.slice(0, 12).map(record => `<tr><td>${esc(new Date(record.at).toLocaleString('zh-CN'))}</td><td>${esc(record.material.name)}<small>${esc(record.material.formula || '')}</small></td><td>${Object.keys(record.values || {}).length}</td><td>${record.seconds || '—'} 秒</td><td><button type="button" data-record="${esc(record.id)}">查看</button></td></tr>`).join('')}
      </tbody></table></div>`;
    panel.querySelectorAll('[data-record]').forEach(button => {
      button.onclick = () => {
        const record = list.find(item => item.id === button.dataset.record);
        if (!record) return;
        const ids = Object.keys(record.values || {}).filter(id => manifest?.model(id));
        if (!manifest || !ids.length) return;
        selectedMaterial = materials.find(m => m.id === record.material.id) || {
          id: record.material.id, name: record.material.name, formula: record.material.formula, atom_count: record.material.atoms,
        };
        container.querySelector('#lab-selected').innerHTML = `<div><b>${esc(record.material.name)}</b><small>来自实验记录 · ${esc(new Date(record.at).toLocaleString('zh-CN'))}</small></div>`;
        renderResults(new Map(Object.entries(record.values)), ids, record.seconds || 0);
        container.querySelector('#lab-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }
}

export { auth as labAuth };
