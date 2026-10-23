const ns = 'http://www.w3.org/2000/svg';

function element(name, attributes = {}, value = '') {
  const node = document.createElementNS(ns, name);
  for (const [key, entry] of Object.entries(attributes)) node.setAttribute(key, String(entry));
  if (value) node.textContent = value;
  return node;
}

function format(value) {
  if (value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6)) return value.toExponential(2);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function extent(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || 1) * 0.08;
  return [min - padding, max + padding];
}

export function renderTreeStep(root, result, stepIndex) {
  const trace = result.treeTrace;
  const step = trace.steps[stepIndex];
  const vectors = result.results.map((row) => row.normalizedVector);
  const dimension = step.dimension;
  const isIsolationForest = result.configuration.algorithm === 'Isolation Forest';
  const samples = trace.sampleIndices;
  const other = vectors[0].length > 1
    ? [...vectors[0].keys()].filter((index) => index !== dimension).sort((a, b) => {
      const distinctA = new Set(samples.map((index) => vectors[index][a])).size;
      const distinctB = new Set(samples.map((index) => vectors[index][b])).size;
      return distinctB - distinctA;
    })[0]
    : -1;
  const active = new Set(step.indices);
  const left = new Set(step.leftIndices);
  const field = result.features[dimension];
  const xValues = samples.map((index) => vectors[index][dimension]);
  const ranks = isIsolationForest && other >= 0
    ? new Map([...samples].sort((a, b) => vectors[a][other] - vectors[b][other] || a - b).map((index, rank) => [index, rank]))
    : null;
  const yValues = samples.map((index, position) => other < 0 ? position : ranks ? ranks.get(index) : vectors[index][other]);
  const [xMin, xMax] = extent(xValues);
  const [yMin, yMax] = extent(yValues);
  const plotWidth = root.querySelector('.tree-plot-wrap').clientWidth < 500 ? 360 : 700;
  const plotLeft = plotWidth < 500 ? 54 : 64;
  const plotRight = plotWidth - (plotWidth < 500 ? 25 : 46);
  const x = (value) => plotLeft + (value - xMin) / (xMax - xMin) * (plotRight - plotLeft);
  const y = (value) => 278 - (value - yMin) / (yMax - yMin) * 226;
  const svg = root.querySelector('#treePlot');
  svg.setAttribute('viewBox', `0 0 ${plotWidth} 330`);
  svg.replaceChildren();
  svg.append(
    element('line', { x1: plotLeft, y1: 278, x2: plotRight, y2: 278, class: 'plot-axis' }),
    element('line', { x1: plotLeft, y1: 52, x2: plotLeft, y2: 278, class: 'plot-axis' }),
    element('line', { x1: x(step.cut), y1: 52, x2: x(step.cut), y2: 278, class: 'plot-cut' }),
  );
  samples.forEach((index, position) => {
    const category = !active.has(index) ? 'outside' : left.has(index) ? 'left' : 'right';
    const dot = element('circle', {
      cx: x(vectors[index][dimension]), cy: y(yValues[position]), r: active.has(index) ? 4.2 : 2.6,
      class: `plot-point plot-${category}`,
    });
    dot.append(element('title', {}, `Bản ghi ${index + 1} · ${category === 'left' ? 'trái' : category === 'right' ? 'phải' : 'ngoài nhánh'}`));
    svg.append(dot);
  });
  svg.append(
    element('text', { x: plotLeft, y: 302, class: 'plot-label' }, format(xMin)),
    element('text', { x: plotRight, y: 302, class: 'plot-label', 'text-anchor': 'end' }, format(xMax)),
    element('text', { x: (plotLeft + plotRight) / 2, y: 324, class: 'plot-label', 'text-anchor': 'middle' }, `${field} (chuẩn hóa)`),
    element('text', { x: plotLeft + 5, y: 42, class: 'plot-label' }, other < 0 ? 'Thứ tự mẫu' : ranks ? `Thứ hạng ${result.features[other]}` : `${result.features[other]} (chuẩn hóa)`),
    element('text', { x: Math.min(plotRight - 65, Math.max(plotLeft + 6, x(step.cut) + 6)), y: 66, class: 'plot-cut-label' }, `cắt ${format(step.cut)}`),
  );

  const median = result.normalization.median[dimension];
  const scale = result.normalization.scale[dimension];
  const rawCut = step.cut * scale + median;
  const widths = vectors[0].map((_, column) => {
    const values = step.indices.map((index) => vectors[index][column]);
    return Math.max(...values) - Math.min(...values);
  });
  const widthTotal = widths.reduce((sum, width) => sum + width, 0);
  root.querySelector('#cutPath').textContent = step.path.replaceAll('Goc', 'Gốc').replaceAll('Trai', 'Trái').replaceAll('Phai', 'Phải');
  root.querySelector('#cutRule').textContent = `${field} ≤ ${format(rawCut)} → trái; > ${format(rawCut)} → phải. Ngưỡng trên vector chuẩn hóa: ${format(step.cut)}.`;
  root.querySelector('#leftCount').textContent = step.leftIndices.length;
  root.querySelector('#rightCount').textContent = step.rightIndices.length;
  root.querySelector('#cutProbability').textContent = isIsolationForest
    ? 'Isolation Forest chọn ngẫu nhiên một chiều và một ngưỡng trong khoảng giá trị của nhánh. Điểm được cô lập qua ít lần cắt thường có điểm bất thường cao hơn.'
    : widthTotal
      ? `Độ rộng chiều cắt trong nhánh: ${format(widths[dimension])} / ${format(widthTotal)} tổng độ rộng (${format(widths[dimension] / widthTotal * 100)}%). RRCF ưu tiên chọn chiều có khoảng giá trị rộng hơn.`
      : 'Các điểm trong nhánh trùng nhau trên mọi chiều.';
  root.querySelector('#cutPosition').textContent = `${stepIndex + 1} / ${trace.steps.length}`;
  root.querySelector('#previousCut').disabled = stepIndex === 0;
  root.querySelector('#nextCut').disabled = stepIndex === trace.steps.length - 1;
  root.querySelector('#cutSlider').value = stepIndex;
  svg.setAttribute('aria-label', `Nhánh ${step.path}: cắt ${field} tại ${format(rawCut)}, ${step.leftIndices.length} điểm bên trái và ${step.rightIndices.length} điểm bên phải.`);
}
