/*
 * cgcnn-engine.js — 在浏览器里运行真实的 CGCNN 晶体图卷积模型。
 *
 * 权重由 ai-engine/tools/export_web_models.py 从原始 PyTorch checkpoint 导出为
 * 原始 float32 二进制，前向计算与 so2-cgcgnn/cgcnn/model.py 逐层对应，输出与
 * 后端 torch 推理一致（差异仅来自浮点累加顺序，通常 < 1e-6）。
 *
 * 这样公网静态页面（GitHub Pages）不需要任何本机服务、不需要安装 Python，
 * 打开网页登录后就能做真实的气体吸附与性质预测。
 */

const SOFTPLUS_THRESHOLD = 20;

function softplus(x) {
  return x > SOFTPLUS_THRESHOLD ? x : Math.log1p(Math.exp(x));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

const symbolToZ = new Map();

export class CgcnnEngine {
  constructor(manifest, baseUrl, fetcher) {
    this.manifest = manifest;
    this.base = baseUrl;
    this.fetcher = fetcher || ((...args) => fetch(...args));
    this.embedding = null;
    this.cache = new Map();
    manifest.symbols.forEach((symbol, index) => symbolToZ.set(symbol, index + 1));
  }

  static async load(baseUrl = './model/', options = {}) {
    const fetcher = options.fetch || ((...args) => fetch(...args));
    const response = await fetcher(baseUrl + 'manifest.json', { cache: 'force-cache' });
    if (!response.ok) throw new Error('模型清单读取失败（' + response.status + '）');
    return new CgcnnEngine(await response.json(), baseUrl, fetcher);
  }

  get models() { return this.manifest.models; }

  model(id) { return this.manifest.models.find(item => item.id === id); }

  async loadEmbedding() {
    if (this.embedding) return this.embedding;
    const spec = this.manifest.atom_embedding;
    const buffer = await (await this.fetcher(this.base + spec.file)).arrayBuffer();
    this.embedding = {
      data: new Float32Array(buffer, 0, spec.shape[0] * spec.shape[1]),
      rows: spec.shape[0],
      dim: spec.shape[1],
    };
    return this.embedding;
  }

  async loadModel(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const spec = this.model(id);
    if (!spec) throw new Error('未知模型：' + id);
    const buffer = await (await this.fetcher(this.base + spec.file)).arrayBuffer();
    const tensors = new Map();
    for (const tensor of spec.tensors) {
      tensors.set(tensor.name, {
        data: new Float32Array(buffer, tensor.offset, tensor.count),
        shape: tensor.shape,
      });
    }
    const loaded = { spec, tensors };
    this.cache.set(id, loaded);
    return loaded;
  }

  /* ---------- 晶体图（对齐 pymatgen get_all_neighbors(8) + CGCNN 填充规则） ---------- */

  buildGraph(structure) {
    const radius = this.manifest.radius;
    const maxNeighbors = this.manifest.max_neighbors;
    const step = this.manifest.gaussian_step;
    const centers = this.manifest.gaussian_count;
    const dim = this.manifest.atom_feature_dim;
    const lattice = structure.lattice;
    const atoms = structure.atoms;
    const n = atoms.length;

    const inverse = invert3(lattice);
    // d_k = 1/|b_k| 是第 k 组晶面间距；|v| >= |f_k| * d_k 给出严格的半径包络
    const spacing = [1 / norm([inverse[0][0], inverse[1][0], inverse[2][0]]),
                     1 / norm([inverse[0][1], inverse[1][1], inverse[2][1]]),
                     1 / norm([inverse[0][2], inverse[1][2], inverse[2][2]])];
    const reach = spacing.map(value => radius / value);

    const frac = new Float64Array(n * 3);
    const features = new Float32Array(n * dim);
    for (let i = 0; i < n; i++) {
      const atom = atoms[i];
      const p = atom.position;
      for (let k = 0; k < 3; k++) {
        frac[i * 3 + k] = p[0] * inverse[0][k] + p[1] * inverse[1][k] + p[2] * inverse[2][k];
      }
      const z = symbolToZ.get(atom.element);
      if (!z || z > 92) throw new Error('结构含当前原子特征表未支持的元素：' + atom.element);
      features[i * dim + (z - 1)] = 1;
    }

    const neighbors = new Int32Array(n * maxNeighbors);
    const rbf = new Float32Array(n * maxNeighbors * centers);
    const bestDist = new Float64Array(maxNeighbors);
    const bestIdx = new Int32Array(maxNeighbors);
    const r2max = radius * radius;
    let padded = 0;

    for (let i = 0; i < n; i++) {
      bestDist.fill(Infinity);
      bestIdx.fill(0);
      let worst = Infinity;
      const fi0 = frac[i * 3], fi1 = frac[i * 3 + 1], fi2 = frac[i * 3 + 2];
      for (let j = 0; j < n; j++) {
        const df0 = frac[j * 3] - fi0;
        const df1 = frac[j * 3 + 1] - fi1;
        const df2 = frac[j * 3 + 2] - fi2;
        const lo0 = Math.ceil(df0 - reach[0]), hi0 = Math.floor(df0 + reach[0]);
        const lo1 = Math.ceil(df1 - reach[1]), hi1 = Math.floor(df1 + reach[1]);
        const lo2 = Math.ceil(df2 - reach[2]), hi2 = Math.floor(df2 + reach[2]);
        for (let m0 = lo0; m0 <= hi0; m0++) {
          const g0 = df0 - m0;
          for (let m1 = lo1; m1 <= hi1; m1++) {
            const g1 = df1 - m1;
            for (let m2 = lo2; m2 <= hi2; m2++) {
              if (i === j && m0 === 0 && m1 === 0 && m2 === 0) continue;
              const g2 = df2 - m2;
              const dx = g0 * lattice[0][0] + g1 * lattice[1][0] + g2 * lattice[2][0];
              const dy = g0 * lattice[0][1] + g1 * lattice[1][1] + g2 * lattice[2][1];
              const dz = g0 * lattice[0][2] + g1 * lattice[1][2] + g2 * lattice[2][2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= r2max || d2 >= worst) continue;
              let slot = maxNeighbors - 1;
              while (slot > 0 && bestDist[slot - 1] > d2) {
                bestDist[slot] = bestDist[slot - 1];
                bestIdx[slot] = bestIdx[slot - 1];
                slot--;
              }
              bestDist[slot] = d2;
              bestIdx[slot] = j;
              worst = bestDist[maxNeighbors - 1];
            }
          }
        }
      }
      let missing = 0;
      for (let m = 0; m < maxNeighbors; m++) {
        const hasNeighbor = Number.isFinite(bestDist[m]);
        if (!hasNeighbor) missing++;
        const distance = hasNeighbor ? Math.sqrt(bestDist[m]) : 9;
        neighbors[i * maxNeighbors + m] = hasNeighbor ? bestIdx[m] : 0;
        const base = (i * maxNeighbors + m) * centers;
        for (let c = 0; c < centers; c++) {
          const delta = distance - c * step;
          rbf[base + c] = Math.exp(-(delta * delta) / (step * step));
        }
      }
      if (missing) padded++;
    }
    return { features, neighbors, rbf, atomCount: n, padded };
  }

  /* ---------- 前向计算（逐层对应 PyTorch 实现） ---------- */

  async predict(modelId, graph) {
    const model = await this.loadModel(modelId);
    await this.loadEmbedding();
    const spec = model.spec;
    const tensors = model.tensors;
    const F = spec.args.atom_fea_len;
    const H = spec.args.h_fea_len;
    const convCount = spec.args.n_conv;
    const heads = spec.args.n_h;
    const N = graph.atomCount;
    const M = this.manifest.max_neighbors;
    const C = this.manifest.gaussian_count;
    const dim = this.manifest.atom_feature_dim;

    const W0 = tensors.get('embedding.weight').data;
    const B0 = tensors.get('embedding.bias').data;
    const emb = this.embedding.data;
    const embDim = this.embedding.dim;
    let h = new Float32Array(N * F);
    for (let a = 0; a < N; a++) {
      const row = a * dim;
      let z = 0;
      for (let k = 0; k < dim; k++) if (graph.features[row + k] !== 0) { z = k; break; }
      const tableRow = z * embDim;
      const outBase = a * F;
      for (let o = 0; o < F; o++) {
        let sum = B0[o];
        const wBase = o * dim;
        for (let k = 0; k < embDim; k++) sum += emb[tableRow + k] * W0[wBase + k];
        h[outBase + o] = sum;
      }
    }

    const inputDim = 2 * F + C;
    const outDim = 2 * F;
    const gated = new Float32Array(outDim);
    const summed = new Float32Array(F);
    const selfTerm = new Float32Array(outDim);
    const nbrTerm = new Float32Array(N * outDim);
    const bn1Scale = new Float32Array(outDim);
    const bn1Shift = new Float32Array(outDim);
    const bn2Scale = new Float32Array(F);
    const bn2Shift = new Float32Array(F);
    for (let layer = 0; layer < convCount; layer++) {
      const prefix = 'convs.' + layer + '.';
      const W = tensors.get(prefix + 'fc_full.weight').data;
      const B = tensors.get(prefix + 'fc_full.bias').data;
      const bn1 = readBatchNorm(tensors, prefix + 'bn1');
      const bn2 = readBatchNorm(tensors, prefix + 'bn2');
      // BatchNorm 在推理态是仿射变换，提前折叠成 乘+加，省掉每个邻居的除法和开方
      for (let o = 0; o < outDim; o++) {
        const scale = bn1.weight[o] / Math.sqrt(bn1.variance[o] + 1e-5);
        bn1Scale[o] = scale;
        bn1Shift[o] = bn1.bias[o] - bn1.mean[o] * scale;
      }
      for (let k = 0; k < F; k++) {
        const scale = bn2.weight[k] / Math.sqrt(bn2.variance[k] + 1e-5);
        bn2Scale[k] = scale;
        bn2Shift[k] = bn2.bias[k] - bn2.mean[k] * scale;
      }
      // 邻居特征块只和邻居原子有关：每个原子算一次，而不是每条边算一次（约 12 倍加速）
      for (let j = 0; j < N; j++) {
        const hjBase = j * F;
        const njBase = j * outDim;
        for (let o = 0; o < outDim; o++) {
          const row = o * inputDim + F;
          let sum = 0;
          for (let k = 0; k < F; k++) sum += W[row + k] * h[hjBase + k];
          nbrTerm[njBase + o] = sum;
        }
      }
      const next = new Float32Array(N * F);
      for (let a = 0; a < N; a++) {
        const hBase = a * F;
        for (let o = 0; o < outDim; o++) {
          const row = o * inputDim;
          let sum = B[o];
          for (let k = 0; k < F; k++) sum += W[row + k] * h[hBase + k];
          selfTerm[o] = sum;
        }
        summed.fill(0);
        for (let m = 0; m < M; m++) {
          const j = graph.neighbors[a * M + m];
          const rbfBase = (a * M + m) * C;
          const njBase = j * outDim;
          for (let o = 0; o < outDim; o++) {
            const row = o * inputDim + 2 * F;
            let sum = selfTerm[o] + nbrTerm[njBase + o];
            for (let k = 0; k < C; k++) sum += W[row + k] * graph.rbf[rbfBase + k];
            const value = sum * bn1Scale[o] + bn1Shift[o];
            gated[o] = o < F ? sigmoid(value) : softplus(value);
          }
          for (let k = 0; k < F; k++) summed[k] += gated[k] * gated[F + k];
        }
        for (let k = 0; k < F; k++) {
          next[hBase + k] = softplus(h[hBase + k] + summed[k] * bn2Scale[k] + bn2Shift[k]);
        }
      }
      h = next;
    }

    const pooled = new Float32Array(F);
    for (let a = 0; a < N; a++) {
      const base = a * F;
      for (let k = 0; k < F; k++) pooled[k] += h[base + k];
    }
    for (let k = 0; k < F; k++) pooled[k] /= N;

    let feature = softplusVector(pooled);
    feature = linear(feature, tensors.get('conv_to_fc.weight').data, tensors.get('conv_to_fc.bias').data, H);
    feature = softplusVector(feature);
    for (let i = 1; i < heads; i++) {
      feature = softplusVector(linear(feature, tensors.get('fcs.' + (i - 1) + '.weight').data,
        tensors.get('fcs.' + (i - 1) + '.bias').data, H));
    }
    const out = linear(feature, tensors.get('fc_out.weight').data, tensors.get('fc_out.bias').data, 1);
    return out[0] * spec.std + spec.mean;
  }
}

function readBatchNorm(tensors, prefix) {
  return {
    weight: tensors.get(prefix + '.weight').data,
    bias: tensors.get(prefix + '.bias').data,
    mean: tensors.get(prefix + '.running_mean').data,
    variance: tensors.get(prefix + '.running_var').data,
  };
}

function batchNorm(value, bn, index) {
  return (value - bn.mean[index]) / Math.sqrt(bn.variance[index] + 1e-5) * bn.weight[index] + bn.bias[index];
}

function linear(input, weight, bias, outDim) {
  const inDim = input.length;
  const out = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let sum = bias[o];
    const base = o * inDim;
    for (let k = 0; k < inDim; k++) sum += weight[base + k] * input[k];
    out[o] = sum;
  }
  return out;
}

function softplusVector(vector) {
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = softplus(vector[i]);
  return out;
}

function invert3(m) {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det || !Number.isFinite(det)) throw new Error('晶格矩阵不可逆');
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function norm(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}
