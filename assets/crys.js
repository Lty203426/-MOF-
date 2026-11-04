/* crys.js - CIF 1.1 解析器 + 晶体学计算引擎（MOF Studio）
 * 纯前端、无依赖。能力：
 *   1) 解析 CIF 1.1（data_ 块 / loop_ / 引号 / 分号文本段 / 注释）
 *   2) 读取晶胞参数与对称操作（_symmetry_equiv_pos_as_xyz 等）
 *   3) 将不对称单位按对称操作展开到完整晶胞并合并等价原子（最小镜像 + 容差）
 *   4) 依据共价半径判据自动成键（跳过金属-金属“键”，金属-配位原子单独标记）
 *   5) 计算化学式、式量、晶胞体积、理论晶体密度
 *   6) 由真实原子坐标计算粉末 X 射线衍射谱（Cromer-Mann 原子散射因子 + 结构因子 + LP 因子 + 峰形展宽）
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  /* ---------------- 元素数据：共价半径(A) / 范德华半径(A) / 相对原子质量 / CPK 颜色 / 中文名 ---------------- */
  const ELEMENTS = {
    H: [0.31, 1.20, 1.008, 0xf2f4f5, '氢'],
    He: [0.28, 1.40, 4.0026, 0xd9ffff, '氦'],
    Li: [1.28, 1.82, 6.94, 0xcc80ff, '锂'],
    B: [0.84, 1.92, 10.81, 0xffb5b5, '硼'],
    C: [0.76, 1.70, 12.011, 0x8f9296, '碳'],
    N: [0.71, 1.55, 14.007, 0x3050f8, '氮'],
    O: [0.66, 1.52, 15.999, 0xff4d40, '氧'],
    F: [0.57, 1.47, 18.998, 0x90e050, '氟'],
    Na: [1.66, 2.27, 22.990, 0xab5cf2, '钠'],
    Mg: [1.41, 1.73, 24.305, 0x8aff00, '镁'],
    Al: [1.18, 1.84, 26.982, 0xbfa6a6, '铝'],
    Si: [1.11, 2.10, 28.085, 0xf0c8a0, '硅'],
    P: [1.07, 1.80, 30.974, 0xff8000, '磷'],
    S: [1.05, 1.80, 32.06, 0xffe000, '硫'],
    Cl: [1.02, 1.75, 35.45, 0x1ff01f, '氯'],
    K: [2.03, 2.75, 39.098, 0x8f40d4, '钾'],
    Ca: [1.76, 2.20, 40.078, 0x3dff00, '钙'],
    Ti: [1.60, 2.00, 47.867, 0xbfc2c7, '钛'],
    Cr: [1.39, 2.00, 51.996, 0x8a99c7, '铬'],
    Mn: [1.39, 2.00, 54.938, 0x9c7ac7, '锰'],
    Fe: [1.32, 2.00, 55.845, 0xe06633, '铁'],
    Co: [1.26, 2.00, 58.933, 0xf090a0, '钴'],
    Ni: [1.24, 1.97, 58.693, 0x50d050, '镍'],
    Cu: [1.32, 1.96, 63.546, 0xcf7a3c, '铜'],
    Zn: [1.22, 2.01, 65.38, 0x7d80b0, '锌'],
    Zr: [1.75, 2.20, 91.224, 0x94e0e0, '锆'],
    Ru: [1.46, 2.00, 101.07, 0x248f8f, '钌'],
    Pd: [1.39, 2.03, 106.42, 0x006985, '钯'],
    Ag: [1.45, 2.00, 107.868, 0xc0c0c0, '银'],
    Cd: [1.44, 2.00, 112.414, 0xffd98f, '镉'],
    In: [1.42, 2.20, 114.818, 0xc28f8f, '铟'],
    Pt: [1.36, 2.00, 195.084, 0xe0e0e0, '铂'],
    Au: [1.36, 2.00, 196.967, 0xffd123, '金']
  };

  const METALS = new Set(['Li', 'Na', 'K', 'Mg', 'Ca', 'Al', 'Ti', 'Cr', 'Mn', 'Fe', 'Co', 'Ni',
    'Cu', 'Zn', 'Zr', 'Ru', 'Pd', 'Ag', 'Cd', 'In', 'Pt', 'Au']);

  function elementInfo(symbol) {
    const s = (symbol || '').trim();
    const key = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const e = ELEMENTS[key];
    if (!e) return { symbol: key, cov: 1.0, vdw: 1.6, mass: 12, color: 0xb0b8bb, name: key, metal: false };
    return { symbol: key, cov: e[0], vdw: e[1], mass: e[2], color: e[3], name: e[4], metal: METALS.has(key) };
  }

  /* ---------------- CIF 词法 / 语法 ---------------- */
  function stripComment(line) {
    let out = '', quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) { out += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
      if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) break;
      out += ch;
    }
    return out;
  }

  function splitValues(text) {
    const parts = text.match(/'[^']*'|"[^"]*"|\S+/g) || [];
    return parts.map(p => {
      if (p.length > 1 && (p[0] === "'" || p[0] === '"') && p[p.length - 1] === p[0]) return p.slice(1, -1);
      return p;
    });
  }

  /** 解析 CIF 文本 -> [ {name, tags:{tag:value}, loops:[{tags:[], rows:[{}]}]} ] */
  function parseCIF(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let cur = null, loopTags = null;
    const ensureBlock = () => {
      if (!cur) { cur = { name: '_', tags: {}, loops: [] }; blocks.push(cur); }
      return cur;
    };

    for (let i = 0; i < lines.length; i++) {
      const s = stripComment(lines[i]).trim();
      if (!s) continue;

      if (/^data_/i.test(s)) {
        cur = { name: s.slice(5).trim() || '_', tags: {}, loops: [] };
        blocks.push(cur);
        loopTags = null;
        continue;
      }
      if (/^save_/i.test(s)) { loopTags = null; continue; }   // 简化：跳过 save_ 帧
      if (/^loop_$/i.test(s)) { loopTags = []; continue; }

      if (s.startsWith('_')) {
        if (loopTags) { loopTags.push(s.toLowerCase()); continue; }
        const m = s.match(/^(\S+)\s+(.+)$/);
        ensureBlock();
        if (m) cur.tags[m[1].toLowerCase()] = splitValues(m[2])[0];
        continue;
      }

      if (s === ';') {   // 分号界定的多行文本段
        const buf = []; i++;
        while (i < lines.length && lines[i].trim() !== ';') { buf.push(lines[i]); i++; }
        ensureBlock();
        const last = Object.keys(cur.tags).pop();
        if (last) cur.tags[last] = buf.join('\n');
        continue;
      }

      // 数据行：在 loop 中按列宽度切分，否则为键值对的值
      ensureBlock();
      if (loopTags && loopTags.length) {
        const rows = [];
        let j = i;
        while (j < lines.length) {
          const raw = stripComment(lines[j]).trim();
          if (!raw || raw.startsWith('_') || /^loop_$/i.test(raw) || /^data_/i.test(raw) || /^save_/i.test(raw) || raw === ';') break;
          const parts = splitValues(raw);
          if (parts.length === loopTags.length) rows.push(parts);
          j++;
        }
        cur.loops.push({ tags: loopTags, rows: rows.map(r => Object.fromEntries(r.map((v, k) => [loopTags[k], v]))) });
        loopTags = null;
        i = j - 1;
        continue;
      }
    }
    return blocks.length ? blocks : [{ name: '_', tags: {}, loops: [] }];
  }

  function firstLoop(loops, names) {
    for (const n of names) {
      const hit = loops.find(l => l.tags.includes(n));
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------- 对称操作 ---------------- */
  const FRAC_RE = /([+]?[-]?[0-9]*)\/([0-9]+)/g;
  function normFrac(expr) {
    // "y+1/2" -> "y+(0.5)"；"-x-1/3" -> "-x-(0.3333)"；"1/2-z" -> "+(0.5)-z"
    return expr.replace(/\s/g, '').replace(FRAC_RE, (m, a, b) => {
      let sign = '';
      let digits = a;
      if (digits.startsWith('+')) { sign = '+'; digits = digits.slice(1); }
      else if (digits.startsWith('-')) { sign = '-'; digits = digits.slice(1); }
      const num = digits === '' ? 1 : Number(digits);
      if (!Number.isFinite(num)) return sign + '0';
      return sign + '(' + (num / Number(b)) + ')';
    });
  }

  function compileOp(op) {
    const parts = [op[0], op[1], op[2]].map(normFrac);
    const body = 'return [' + parts.join(',') + '];';
    // eslint-disable-next-line no-new-func
    return new Function('x', 'y', 'z', body);
  }

  const DEFAULT_OPS = [[['x'], ['y'], ['z']]];

  /** 从对称操作的平移部分提取格子中心化向量（如 F 心的 0,0,0 / 0,½,½ / ½,0,½ / ½,½,0） */
  function centeringVectors(ops) {
    const seen = [], vecs = [];
    ops.forEach(op => {
      let t;
      try { t = op(0, 0, 0); } catch (e) { return; }
      if (!t || !t.every(Number.isFinite)) return;
      const v = t.map(x => { const y = ((x % 1) + 1) % 1; return (y > 0.9999 || y < 1e-4) ? 0 : Number(y.toFixed(6)); });
      const key = v.join(',');
      if (seen.indexOf(key) < 0) { seen.push(key); vecs.push(v); }
    });
    return vecs;
  }

  /** 中心化格子导致的系统消光判定：Σ exp[2πi(h·t)] ≈ 0 → 该衍射不可观测 */
  function centeringFactor(h, k, l, vecs) {
    if (!vecs || vecs.length <= 1) return 1;
    let re = 0, im = 0;
    for (const t of vecs) {
      const phi = TAU * (h * t[0] + k * t[1] + l * t[2]);
      re += Math.cos(phi); im += Math.sin(phi);
    }
    return (re * re + im * im) / (vecs.length * vecs.length);
  }

  function symmetryOps(block) {
    const loop = firstLoop(block.loops, [
      '_symmetry_equiv_pos_as_xyz',
      '_space_group_symop_operation_xyz',
      '_symmetry_equiv_pos_site_as_xyz'
    ]);
    if (!loop) return DEFAULT_OPS.map(o => o.map(String));
    return loop.rows.map(r => {
      const raw = r[loop.tags[0]];
      return String(raw).replace(/^'|'$/g, '').split(',');
    }).filter(o => o.length === 3);
  }

  /* ---------------- 晶胞几何 ---------------- */
  function makeCell(tags) {
    const num = (k, d) => { const v = Number(tags[k]); return Number.isFinite(v) ? v : d; };
    const a = num('_cell_length_a', 1), b = num('_cell_length_b', a), c = num('_cell_length_c', a);
    const al = num('_cell_angle_alpha', 90), be = num('_cell_angle_beta', 90), ga = num('_cell_angle_gamma', 90);
    const ar = al * Math.PI / 180, br = be * Math.PI / 180, gr = ga * Math.PI / 180;
    const ca = Math.cos(ar), cb = Math.cos(br), cg = Math.cos(gr), sg = Math.sin(gr);
    const volume = a * b * c * Math.sqrt(Math.max(1e-9,
      1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
    // 分数 -> 笛卡尔（a 沿 x，b 在 xy 平面）
    const M = [
      [a, b * cg, c * cb],
      [0, b * sg, c * (ca - cb * cg) / (sg || 1)],
      [0, 0, volume / (a * b * (sg || 1))]
    ];
    return { a, b, c, alpha: al, beta: be, gamma: ga, volume, M };
  }

  function fracToCart(f, M) {
    return [f[0] * M[0][0] + f[1] * M[1][0] + f[2] * M[2][0],
      f[0] * M[0][1] + f[1] * M[1][1] + f[2] * M[2][1],
      f[0] * M[0][2] + f[1] * M[1][2] + f[2] * M[2][2]];
  }

  /* ---------------- 结构构建 ---------------- */
  /**
   * @param {string} cifText
   * @param {object} opts { supercell:[nx,ny,nz], maxAtoms:number }
   */
  function buildStructure(cifText, opts) {
    opts = opts || {};
    const supercell = opts.supercell || [1, 1, 1];
    const maxAtoms = opts.maxAtoms || 6000;
    const blocks = parseCIF(cifText);
    const block = blocks[0];
    const cell = makeCell(block.tags);
    const ops = symmetryOps(block).map(compileOp);
    const centering = centeringVectors(ops);   // 用于系统消光快速判定

    const atomLoop = firstLoop(block.loops, ['_atom_site_label', '_atom_site_type_symbol']);
    if (!atomLoop) throw new Error('CIF 中未找到 _atom_site 数据块');
    const tags = atomLoop.tags;
    const tLabel = tags.find(t => t === '_atom_site_label') || tags[0];
    const tType = tags.find(t => t === '_atom_site_type_symbol') || tLabel;
    const tX = tags.find(t => t === '_atom_site_fract_x');
    const tY = tags.find(t => t === '_atom_site_fract_y');
    const tZ = tags.find(t => t === '_atom_site_fract_z');
    const tOcc = tags.find(t => t === '_atom_site_occupancy');
    const tU = tags.find(t => t === '_atom_site_u_iso_or_equiv') || tags.find(t => t === '_atom_site_b_iso_or_equiv');

    /* --- 展开对称操作 --- */
    const raw = [];
    for (const row of atomLoop.rows) {
      const symbol = row[tType] || row[tLabel];
      const fx = Number(row[tX]), fy = Number(row[tY]), fz = Number(row[tZ]);
      if (![fx, fy, fz].every(Number.isFinite)) continue;
      const occ = tOcc && row[tOcc] !== undefined ? Number(row[tOcc]) : 1;
      const u = tU && row[tU] !== undefined ? Number(row[tU]) : 0;
      for (const op of ops) {
        let g;
        try { g = op(fx, fy, fz); } catch (e) { continue; }
        if (!g || !g.every(Number.isFinite)) continue;
        raw.push({ el: symbol, label: row[tLabel] || symbol, f: [g[0] % 1, g[1] % 1, g[2] % 1], occ: Number.isFinite(occ) ? occ : 1, u: Number.isFinite(u) ? u : 0 });
      }
    }

    /* --- 合并等价 / 重叠原子（卷绕到 [0,1)） --- */
    const wrap = v => { const x = v % 1; return x < 0 ? x + 1 : x; };
    const tol = 1e-3;
    const merged = [];
    for (const at of raw) {
      const f = at.f.map(wrap);
      let hit = null;
      for (let i = 0; i < merged.length; i++) {
        const m = merged[i];
        if (m.el !== at.el) continue;
        let d = 0;
        for (let k = 0; k < 3; k++) { let dd = Math.abs(m.f[k] - f[k]); if (dd > 0.5) dd = 1 - dd; if (dd > d) d = dd; }
        if (d < tol) { hit = m; break; }
      }
      if (hit) { hit.occ = Math.max(hit.occ, at.occ); }
      else merged.push({ el: at.el, label: at.label, f, occ: at.occ, u: at.u });
    }

    /* --- 超胞复制 --- */
    const [nx, ny, nz] = supercell;
    const atoms = [];
    for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) {
      for (const a of merged) {
        atoms.push({
          el: a.el, label: a.label, u: a.u, occ: a.occ,
          f: [(a.f[0] + ix) / nx, (a.f[1] + iy) / ny, (a.f[2] + iz) / nz]
        });
      }
    }
    if (atoms.length > maxAtoms) atoms.length = maxAtoms;

    const cart = atoms.map(a => fracToCart(a.f, cell.M));

    /* --- 成键 --- */
    const bonds = bondPerception(atoms, cart, cell);

    /* --- 元素索引表：结构因子求和按元素分组，避免逐原子查表 --- */
    const symbols = [];
    atoms.forEach(a => {
      const s = elementInfo(a.el).symbol;
      if (symbols.indexOf(s) < 0) symbols.push(s);
    });
    atoms.forEach(a => { a.ei = symbols.indexOf(elementInfo(a.el).symbol); });
    const fTable = { nEl: symbols.length, SCAT: symbols.map(s => SCATTER[s]) };

    /* --- 化学式与密度 --- */
    const composition = {};
    atoms.forEach(a => { const k = elementInfo(a.el).symbol; composition[k] = (composition[k] || 0) + a.occ; });
    const formula = formatFormula(composition);
    const formulaWeight = Object.keys(composition).reduce((s, k) => s + composition[k] * elementInfo(k).mass, 0);
    const fullVolume = cell.volume * nx * ny * nz;
    // 由晶胞内容推出 Z：各元素个数约去最大公约数
    const counts = Object.values(composition).map(v => Math.round(v));
    let gcd = counts[0] || 1;
    counts.forEach(v => {
      let a = Math.abs(gcd), b2 = Math.abs(v);
      while (b2) { const t = b2; b2 = a % t; a = t; }
      gcd = a;
    });
    const Ztot = gcd > 0 ? gcd : 1;

    return {
      name: String(block.tags['_chemical_formula_sum'] || block.tags['_chemical_name_common'] || 'CIF 结构').replace(/[';]/g, '').trim(),
      cell, atoms, cart, bonds, composition, formula, formulaWeight, fTable, centering,
      volume: fullVolume,
      // ρ = 晶胞内原子总质量 / 晶胞体积；Z × M(formula) 即晶胞内总质量
      density: fullVolume > 0 ? formulaWeight / (0.602214 * fullVolume) : 0,
      Z: Ztot,
      spaceGroup: String(block.tags['_symmetry_space_group_name_h-m'] || block.tags['_space_group_name_h-m_alt'] || '—').replace(/'/g, '').trim(),
      nSymmetry: ops.length
    };
  }

  /** 基于共价半径的成键判定；返回 {i,j,d(Å),kind} */
  function bondPerception(atoms, cart, cell, tolerance) {
    tolerance = tolerance === undefined ? 0.45 : tolerance;
    const n = atoms.length;
    const info = atoms.map(a => elementInfo(a.el));
    const bonds = [];
    // 最大可能键长（用于预筛）
    let maxBond = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) maxBond = Math.max(maxBond, info[i].cov + info[j].cov + tolerance);
    const L = Math.max(cell.a, cell.b, cell.c);
    const half = L / 2;
    // 立方/近似立方时可直接用最小镜像；这里用 3x3x3 平移搜索，保证跨边界成键不丢
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (info[i].metal && info[j].metal) continue;   // 不画金属-金属键
        const limit = info[i].cov + info[j].cov + tolerance;
        let best = Infinity, bestVec = null;
        for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) for (let dw = -1; dw <= 1; dw++) {
          let dx = cart[j][0] + du * cell.a - cart[i][0];
          let dy = cart[j][1] + dv * cell.b - cart[i][1];
          let dz = cart[j][2] + dw * cell.c - cart[i][2];
          if (Math.abs(dx) > limit || Math.abs(dy) > limit || Math.abs(dz) > limit) {
            // 快速路径：若本平移量已超限，仅当其为最小镜像候选时再考虑
            if (Math.abs(dx) > half || Math.abs(dy) > half || Math.abs(dz) > half) continue;
          }
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) { best = d2; bestVec = [dx, dy, dz]; }
        }
        const d = Math.sqrt(best);
        if (bestVec && d < limit && d > 0.4) {
          const kind = (info[i].metal || info[j].metal) ? 'coord' : 'covalent';
          bonds.push({ i, j, d, kind, vec: bestVec });
        }
      }
    }
    return bonds;
  }

  /* ---------------- 化学式 ---------------- */
  function formatFormula(comp) {
    const order = ['C', 'H', 'N', 'O', 'S', 'Cl', 'Br', 'F', 'P', 'Si', 'Cu', 'Zn', 'Zr', 'Fe', 'Co', 'Ni', 'Al', 'Mg', 'Ca', 'Ti', 'Cr', 'Mn', 'Cd', 'In', 'Li', 'Na', 'K', 'Ag', 'Au', 'Pd', 'Pt', 'Ru'];
    const keys = Object.keys(comp);
    keys.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return keys.map(k => {
      const n = comp[k];
      const r = Math.round(n * 100) / 100;
      return k + (Math.abs(r - 1) < 0.01 ? '' : String(r));
    }).join(' ');
  }

  /* ---------------- Cromer-Mann 原子散射因子（国际晶体学表 C 卷，1992） ---------------- */
  /* 顺序: a1 a2 a3 a4  b1 b2 b3 b4  c */
  const SCATTER = {
    H: [0.493002, 0.322912, 0.140191, 0.040810, 10.5109, 26.1257, 3.14236, 57.7997, 0.003038],
    C: [2.31000, 1.02000, 1.58860, 0.865000, 20.8439, 10.2075, 0.568700, 51.6512, 0.215600],
    N: [12.2126, 3.13220, 2.01250, 1.16630, 0.005700, 9.89330, 28.9975, 0.582600, -11.529],
    O: [3.04850, 2.28680, 1.54630, 0.867000, 13.2771, 5.70110, 0.323900, 32.9089, 0.250800],
    F: [3.53920, 2.64120, 1.51700, 1.02430, 10.2825, 4.29440, 0.261500, 26.1476, 0.277600],
    Na: [4.76260, 3.17360, 1.26740, 1.11280, 3.28500, 8.84220, 0.313600, 129.424, 0.676000],
    Mg: [5.42040, 2.17350, 1.22690, 2.30730, 2.82750, 79.2611, 0.380800, 7.19370, 0.858400],
    Al: [6.42020, 1.90020, 1.59360, 1.96460, 3.03870, 0.742600, 31.5472, 85.0886, 1.11510],
    Si: [6.29150, 3.03530, 1.98910, 1.54100, 2.43860, 32.3337, 0.678500, 81.6937, 1.14070],
    P: [6.43450, 4.17910, 1.78000, 1.49080, 1.90670, 27.1570, 0.526000, 68.1645, 1.11490],
    S: [6.90530, 5.20340, 1.43790, 1.58630, 1.46790, 22.2151, 0.253600, 56.1720, 0.866900],
    Cl: [11.4604, 7.19640, 6.25560, 1.64550, 0.010400, 1.16620, 18.5194, 47.7784, -9.5574],
    K: [8.21860, 7.43980, 1.05190, 0.865900, 12.7949, 0.774800, 213.187, 41.6841, 1.42280],
    Ca: [8.62660, 7.38730, 1.58990, 1.02110, 10.4421, 0.659900, 85.7484, 178.437, 1.37510],
    Ti: [9.75950, 7.35580, 1.69910, 1.90210, 7.85080, 0.500000, 35.6338, 116.105, 1.28070],
    Cr: [10.6406, 7.35370, 3.32400, 1.49220, 6.10380, 0.392000, 20.2626, 98.7399, 1.18320],
    Mn: [11.2819, 7.35730, 3.01930, 2.24410, 5.34090, 0.343200, 17.8674, 83.7543, 1.08960],
    Fe: [11.7695, 7.35730, 3.52220, 2.30450, 4.76110, 0.307200, 15.3535, 76.8805, 1.03690],
    Co: [12.2841, 7.34090, 4.00340, 2.34880, 4.27910, 0.278400, 13.5359, 71.1692, 1.01180],
    Ni: [12.8376, 7.29200, 4.44380, 2.38000, 3.87850, 0.256500, 12.1763, 66.3421, 1.03410],
    Cu: [13.3380, 7.16760, 5.61580, 1.67350, 3.58280, 0.247000, 11.3966, 64.8126, 1.19100],
    Zn: [14.0743, 7.03180, 5.16520, 2.41000, 3.26550, 0.233300, 10.3163, 58.7097, 1.30410],
    Zr: [17.87650, 10.9480, 5.41732, 3.65721, 1.27618, 0.117622, 11.9160, 87.6627, 2.06929],
    Ru: [19.2674, 12.91820, 4.86337, 1.56756, 0.80852, 8.43467, 24.7997, 94.2928, 5.37874],
    Pd: [19.3319, 15.50170, 5.29537, 0.605844, 0.698655, 7.98929, 25.2052, 76.8986, 5.26593],
    Ag: [19.2808, 16.68850, 4.80450, 1.04630, 0.64460, 7.47260, 24.6605, 99.8156, 5.17900],
    Cd: [19.2214, 17.64440, 4.46100, 1.60290, 0.59460, 6.90890, 24.7008, 87.4825, 5.06940],
    In: [19.1624, 18.55960, 4.29480, 2.03960, 0.54760, 6.37760, 25.8499, 92.8029, 4.93910],
    Pt: [27.00590, 17.76390, 15.71310, 5.78370, 1.51293, 8.81174, 0.424593, 38.6103, 11.6883],
    Au: [16.8819, 18.59130, 25.5582, 5.86000, 0.461100, 8.62160, 1.482600, 36.3956, 12.0658]
  };

  /** f(sinθ/λ) */
  function scatteringFactor(symbol, s) {
    const c = SCATTER[elementInfo(symbol).symbol];
    if (!c) {
      const e = elementInfo(symbol);
      return e.mass / 2;      // 未列表元素的粗略近似
    }
    const s2 = s * s;
    return c[0] * Math.exp(-c[4] * s2) + c[1] * Math.exp(-c[5] * s2)
      + c[2] * Math.exp(-c[6] * s2) + c[3] * Math.exp(-c[7] * s2) + c[8];
  }

  /* ---------------- 倒易格子与粉末衍射 ---------------- */
  function reciprocalMetric(cell) {
    const { a, b, c, volume } = cell;
    const ar = cell.alpha * Math.PI / 180, br = cell.beta * Math.PI / 180, gr = cell.gamma * Math.PI / 180;
    const sa = Math.sin(ar), sb = Math.sin(br), sg = Math.sin(gr);
    const ast = b * c * sa / volume, bst = a * c * sb / volume, cst = a * b * sg / volume;
    const cosa = (Math.cos(br) * Math.cos(gr) - Math.cos(ar)) / (sb * sg);
    const cosb = (Math.cos(ar) * Math.cos(gr) - Math.cos(br)) / (sa * sg);
    const cosg = (Math.cos(ar) * Math.cos(br) - Math.cos(gr)) / (sa * sb);
    return { ast, bst, cst, cosa, cosb, cosg };
  }

  /**
   * 由真实原子坐标计算粉末衍射谱
   * @param {object} structure buildStructure() 的返回
   * @param {object} opts { wavelength, twoThetaMin, twoThetaMax, step, fwhm, hmax }
   */
  function powderPattern(structure, opts) {
    opts = opts || {};
    const lambda = opts.wavelength || 1.540598;          // Cu Kα1, Å
    const t0 = opts.twoThetaMin === undefined ? 3 : opts.twoThetaMin;
    const t1 = opts.twoThetaMax === undefined ? 50 : opts.twoThetaMax;
    const step = opts.step || 0.02;
    const fwhm = opts.fwhm || 0.14;                     // 2θ 半高全宽（度）
    const hmax = opts.hmax || 12;
    const cell = structure.cell;
    const rm = reciprocalMetric(cell);
    const n = Math.max(2, Math.round((t1 - t0) / step) + 1);
    const grid = new Float64Array(n);
    const reflections = [];
    const fTable = structure.fTable || { nEl: 0, SCAT: [] };
    const nEl = fTable.nEl, SCAT = fTable.SCAT;
    const atoms = structure.atoms, nAtoms = atoms.length;

    const dMin = lambda / (2 * Math.sin(Math.min(89, t1 / 2) * Math.PI / 180));
    // 只枚举能落在扫描范围内的 hkl
    const limit = (h, k, l) => {
      const invD2 = h * h * rm.ast * rm.ast + k * k * rm.bst * rm.bst + l * l * rm.cst * rm.cst
        + 2 * h * k * rm.ast * rm.bst * rm.cosg
        + 2 * h * l * rm.ast * rm.cst * rm.cosb
        + 2 * k * l * rm.bst * rm.cst * rm.cosa;
      return invD2;
    };

    for (let h = -hmax; h <= hmax; h++) {
      for (let k = -hmax; k <= hmax; k++) {
        for (let l = -hmax; l <= hmax; l++) {
          if (h === 0 && k === 0 && l === 0) continue;
          const invD2 = limit(h, k, l);
          if (!(invD2 > 0)) continue;
          const d = 1 / Math.sqrt(invD2);
          if (d < dMin) continue;
          const sinTheta = lambda / (2 * d);
          if (sinTheta > 0.999) continue;
          const twoTheta = 2 * Math.asin(sinTheta) * 180 / Math.PI;
          if (twoTheta < t0 - 0.6 || twoTheta > t1 + 0.6) continue;
          /* 系统消光：中心化格子（F / I / C…）使部分 hkl 的结构因子恒为零，
             直接跳过可省去约 3/4 的无效求和，且不会改变结果。 */
          if (centeringFactor(h, k, l, structure.centering) < 1e-8) continue;

          /* 结构因子 F(hkl) = Σ f_j · exp[2πi(hx+ky+lz)] · occ · Debye-Waller
             按元素分组累加 cos / sin，避免每个原子重复做元素查表 */
          const s = sinTheta / lambda, s2 = s * s;
          const f = new Float64Array(nEl);
          for (let e = 0; e < nEl; e++) {
            const c = SCAT[e];
            f[e] = c[0] * Math.exp(-c[4] * s2) + c[1] * Math.exp(-c[5] * s2)
              + c[2] * Math.exp(-c[6] * s2) + c[3] * Math.exp(-c[7] * s2) + c[8];
          }
          let re = 0, im = 0;
          for (let a = 0; a < nAtoms; a++) {
            const at = atoms[a];
            const phi = TAU * (h * at.f[0] + k * at.f[1] + l * at.f[2]);
            const w = f[at.ei] * at.occ * Math.exp(-8 * Math.PI * Math.PI * at.u * s2);
            re += w * Math.cos(phi);
            im += w * Math.sin(phi);
          }
          const f2 = re * re + im * im;
          /* Lorentz-偏振因子（无单色器，非偏振入射） */
          const rad = twoTheta * Math.PI / 360;                    // θ
          const st = Math.sin(rad), ct = Math.cos(rad);
          const lp = (1 + Math.cos(2 * rad) * Math.cos(2 * rad)) / (st * st * ct || 1e-6);
          const intensity = f2 * lp;
          reflections.push({ h, k, l, twoTheta, d, I: intensity });
        }
      }
    }

    /* 高斯峰形叠加 */
    const sigma = fwhm / 2.3548;
    const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));
    for (const r of reflections) {
      const center = (r.twoTheta - t0) / step;
      const from = Math.max(0, Math.floor(center - 3.5 * sigma / step));
      const to = Math.min(n - 1, Math.ceil(center + 3.5 * sigma / step));
      for (let i = from; i <= to; i++) {
        const z = (i - center) * step / sigma;
        grid[i] += r.I * norm * Math.exp(-0.5 * z * z);
      }
    }

    let maxI = 0;
    for (let i = 0; i < n; i++) if (grid[i] > maxI) maxI = grid[i];
    if (maxI > 0) for (let i = 0; i < n; i++) grid[i] /= maxI;

    /* --- 可观测衍射峰：合并等价反射（多重性），剔除系统消光反射 --- */
    let maxRef = 0;
    for (const r of reflections) if (r.I > maxRef) maxRef = r.I;
    const merged = [];
    if (maxRef > 0) {
      for (const r of reflections) {
        if (r.I < maxRef * 1e-8) continue;                 // 系统消光（F 心 / 螺旋轴等）
        const hit = merged.find(m => Math.abs(m.twoTheta - r.twoTheta) < 0.03);
        if (hit) {
          hit.multiplicity++; hit.I += r.I;
          if (r.I > hit.maxI) { hit.maxI = r.I; hit.h = r.h; hit.k = r.k; hit.l = r.l; }
        } else {
          merged.push({ twoTheta: r.twoTheta, I: r.I, maxI: r.I, d: r.d, h: r.h, k: r.k, l: r.l, multiplicity: 1 });
        }
      }
      merged.forEach(m => { m.rel = m.maxI / maxRef; });
      merged.sort((a, b) => a.twoTheta - b.twoTheta);
    }

    reflections.sort((a, b) => b.I - a.I);
    return { t0, t1, step, grid, reflections, merged, maxRaw: maxI };
  }

  /** 从（可能是实验）文本列数据读取 2θ–强度 序列 */
  function parseXY(text) {
    const rows = [];
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(line => {
      const s = stripComment(line).trim();
      if (!s) return;
      if (/^[_#]/.test(s) || /[A-Za-z一-龥]/.test(s)) return;
      const m = s.match(/^\s*([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)[ \t,;]+([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/);
      if (m) rows.push([Number(m[1]), Number(m[2])]);
    });
    rows.sort((a, b) => a[0] - b[0]);
    return { points: rows };
  }

  /** 寻峰：归一化 → 邻域极大 → 突起高度（prominence）阈值 → 非极大抑制
      说明：先将强度归一化到最大值 1，再按邻域窗口判断是否为局部极大，
      并要求峰顶高出邻域最低点至少 minProminence，避免把噪声尖峰当作衍射峰。 */
  function findPeaks(points, minProminence) {
    minProminence = minProminence === undefined ? 0.05 : minProminence;
    const pts = (points.points || points).slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length;
    if (n < 2) return [];

    let mx = 0;
    for (const p of pts) if (p[1] > mx) mx = p[1];
    if (!(mx > 0)) return [];

    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = pts[i][1] / mx;

    // 半窗口随数据密度自适应，稀疏数据用 ±1，密集数据适当放宽
    const w = Math.max(1, Math.min(15, Math.round(n / 120)));
    const localMax = [];
    for (let i = 0; i < n; i++) {
      const y1 = y[i];
      if (y1 <= minProminence) continue;
      const lo0 = Math.max(0, i - w), hi0 = Math.min(n - 1, i + w);
      let isMax = true, lo = y1;
      for (let j = lo0; j <= hi0; j++) {
        if (j === i) continue;
        if (y[j] > y1) { isMax = false; break; }
        if (y[j] < lo) lo = y[j];
      }
      if (!isMax) continue;
      if (y1 - lo < minProminence) continue;
      localMax.push({ twoTheta: pts[i][0], I: pts[i][1], rel: y1 });
    }

    // 非极大抑制：相邻过近时保留更强的峰
    localMax.sort((a, b) => a.twoTheta - b.twoTheta);
    const kept = [];
    for (const p of localMax) {
      const last = kept[kept.length - 1];
      if (!last || p.twoTheta - last.twoTheta > 0.12) { kept.push(p); continue; }
      if (p.rel > last.rel) kept[kept.length - 1] = p;
    }
    return kept.map(p => ({ twoTheta: p.twoTheta, I: p.I }));
  }

  /** 将导入的实测谱与 CIF 计算谱做峰位匹配，输出匹配表与偏差统计 */
  function comparePatterns(measured, calculated, tolDeg) {
    tolDeg = tolDeg === undefined ? 0.35 : tolDeg;
    const mPeaks = findPeaks(measured.points || measured, 0.06);
    // 优先使用已合并等价面、剔除系统消光的可观测峰表
    const src = (calculated.merged && calculated.merged.length)
      ? calculated.merged.filter(m => m.rel >= 0.02)
      : (calculated.reflections || []).slice(0, 40)
        .map(r => ({ twoTheta: r.twoTheta, I: r.I, h: r.h, k: r.k, l: r.l, d: r.d }));
    const cPeaks = src.slice().sort((a, b) => a.twoTheta - b.twoTheta);

    const matches = [];
    mPeaks.forEach(mp => {
      let best = null, bestD = 1e9;
      cPeaks.forEach(cp => {
        const d = Math.abs(cp.twoTheta - mp.twoTheta);
        if (d < bestD) { bestD = d; best = cp; }
      });
      if (best && bestD <= tolDeg) matches.push({ measured: mp.twoTheta, calc: best.twoTheta, delta: bestD, h: best.h, k: best.k, l: best.l, d: best.d });
    });

    const deltas = matches.map(m => m.delta);
    return {
      measuredPeaks: mPeaks,
      calculatedPeaks: cPeaks,
      matches,
      matched: matches.length,
      total: mPeaks.length,
      meanDelta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null
    };
  }

  global.Crys = {
    ELEMENTS, METALS, elementInfo,
    parseCIF, buildStructure, bondPerception,
    powderPattern, parseXY, findPeaks, comparePatterns,
    scatteringFactor, centeringVectors, centeringFactor
  };
})(window);
