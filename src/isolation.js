import './styles.css';
import './isolation.css';
import { createIcons, Split, ArrowLeft, FileJson2, Upload, FlaskConical, Download, Play, ScanLine, ChevronLeft, ChevronRight, ArrowUpRight } from 'lucide';
import { parseDataset, toPoints, readAnalysis, MAX_FILE_BYTES } from './dataset.js';
import { renderTreeStep } from './tree-explorer.js';

createIcons({ icons: { Split, ArrowLeft, FileJson2, Upload, FlaskConical, Download, Play, ScanLine, ChevronLeft, ChevronRight, ArrowUpRight } });
const $ = (selector) => document.querySelector(selector);
let dataset;
let result;
let busy = false;
let fileVersion = 0;
let treeStep = 0;
let page = 0;
let selectedRow;
const pageSize = 8;

function showError(message = '') {
  $('#errorMessage').textContent = message;
  $('#errorMessage').hidden = !message;
}

function setFlow(done, active = -1, progress = done / 4 * 100) {
  document.querySelectorAll('#pipeline li').forEach((step, index) => {
    step.classList.toggle('is-done', index < done);
    step.classList.toggle('is-active', index === active);
  });
  $('#flowProgress').textContent = `${done} / 4 bước`;
  $('#analysisProgress').value = progress;
}

function selectedFields() {
  return [...document.querySelectorAll('#fieldChoices input:checked')].map((input) => input.value);
}

function clearResult() {
  result = undefined;
  page = 0;
  treeStep = 0;
  selectedRow = undefined;
  $('#treeContent').hidden = true;
  $('#emptyTree').hidden = false;
  $('#treeExplorerMeta').textContent = 'Chưa có cây được dựng';
  $('#downloadResult').disabled = true;
  $('#resultContent').hidden = true;
  $('#emptyResult').hidden = false;
  $('#onlyAnomalies').checked = false;
  for (const name of ['total', 'normal', 'anomaly', 'score']) $(`#${name}Metric`).textContent = '—';
  $('#resultMeta').textContent = 'Chưa có kết quả';
  $('#outputPreview').textContent = '{ "results": [] }';
  $('#outputPreviewMeta').textContent = 'Chưa có kết quả';
  $('#runBadge').textContent = dataset ? 'Dữ liệu sẵn sàng' : 'Chờ dữ liệu';
  $('#runBadge').className = 'status-badge';
}

function validateSelection() {
  showError();
  clearResult();
  try {
    if (!dataset) return;
    const fields = selectedFields();
    toPoints(dataset, fields);
    $('#analyzeButton').disabled = false;
    $('#inputStatus').textContent = `${dataset.rows.length} bản ghi hợp lệ · ${fields.length} trường số.`;
    setFlow(1);
  } catch (error) {
    $('#analyzeButton').disabled = true;
    $('#inputStatus').textContent = 'Dữ liệu cần kiểm tra.';
    showError(error.message);
    setFlow(0);
  }
}

function loadText(text, name) {
  dataset = undefined;
  clearResult();
  $('#fieldChoices').replaceChildren();
  $('#fieldSection').hidden = true;
  $('#fileName').textContent = name;
  $('#fileMeta').textContent = 'Đang kiểm tra';
  $('#inputPreview').textContent = '[]';
  $('#analyzeButton').disabled = true;
  showError();
  try {
    dataset = parseDataset(text, name);
    $('#fileMeta').textContent = `${dataset.rows.length} bản ghi · ${(new TextEncoder().encode(text).length / 1024).toFixed(1)} KB`;
    $('#fieldSection').hidden = false;
    dataset.fields.forEach((field, index) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = field;
      checkbox.checked = index < 20;
      label.append(checkbox, document.createTextNode(field));
      $('#fieldChoices').append(label);
    });
    $('#inputPreview').textContent = JSON.stringify(dataset.rows.slice(0, 3), null, 2);
    $('#inputPreviewMeta').textContent = `3 / ${dataset.rows.length} bản ghi đầu`;
    validateSelection();
  } catch (error) {
    $('#fileMeta').textContent = 'Tệp chưa hợp lệ';
    $('#inputStatus').textContent = 'Chưa có dữ liệu hợp lệ.';
    $('#inputPreviewMeta').textContent = 'Tệp chưa hợp lệ';
    showError(error.message);
    setFlow(0);
  }
}

async function loadFile(file) {
  if (!file || busy) return;
  const version = ++fileVersion;
  if (file.size > MAX_FILE_BYTES) {
    loadText('', file.name);
    return showError('Tệp vượt quá 5 MB.');
  }
  $('#inputStatus').textContent = 'Đang đọc tệp…';
  try {
    const text = await file.text();
    if (version === fileVersion) loadText(text, file.name);
  } catch { showError('Không đọc được tệp JSON. Hãy chọn lại tệp.'); }
}

function setBusy(value) {
  busy = value;
  for (const selector of ['#fileInput', '#sampleButton', '#trees', '#sampleSize', '#contamination']) $(selector).disabled = value;
  document.querySelectorAll('#fieldChoices input').forEach((input) => { input.disabled = value; });
  $('#analyzeButton').disabled = value || !dataset;
  $('#analyzeButton span').textContent = value ? 'Đang phân tích…' : 'Phân tích JSON';
  if (value) {
    $('#runBadge').textContent = 'Đang tính toán';
    $('#runBadge').className = 'status-badge is-running';
  }
}

function previewRow(record) {
  selectedRow = record.rowIndex;
  $('#inputPreview').textContent = JSON.stringify(record.input, null, 2);
  $('#inputPreviewMeta').textContent = `Bản ghi ${record.rowIndex + 1}`;
  $('#outputPreview').textContent = JSON.stringify(record, null, 2);
  $('#outputPreviewMeta').textContent = `Bản ghi ${record.rowIndex + 1} · kết quả thực`;
  document.querySelectorAll('#resultRows tr').forEach((row) => row.classList.toggle('is-selected', Number(row.dataset.row) === selectedRow));
}

function renderTable() {
  if (!result) return;
  const records = result.results.filter((row) => !$('#onlyAnomalies').checked || row.isAnomaly).sort((a, b) => b.score - a.score);
  page = Math.max(0, Math.min(page, Math.ceil(records.length / pageSize) - 1));
  const visible = records.slice(page * pageSize, (page + 1) * pageSize);
  $('#resultRows').replaceChildren();
  visible.forEach((record) => {
    const row = document.createElement('tr');
    row.classList.toggle('is-anomaly', record.isAnomaly);
    row.classList.toggle('is-selected', record.rowIndex === selectedRow);
    row.dataset.row = record.rowIndex;
    row.tabIndex = 0;
    const identity = !Array.isArray(record.input) ? record.input.id ?? record.input._id : undefined;
    const label = typeof identity === 'string' || typeof identity === 'number' ? String(identity) : `#${record.rowIndex + 1}`;
    const cells = [label, `[${record.vector.join(', ')}]`, record.score.toFixed(4), String(record.firstTreeDepth), record.isAnomaly ? 'Bất thường' : 'Bình thường'];
    cells.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 4) cell.className = `result-tag${record.isAnomaly ? ' is-anomaly' : ''}`;
      row.append(cell);
    });
    row.addEventListener('click', () => previewRow(record));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') previewRow(record); });
    $('#resultRows').append(row);
  });
  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Không có bản ghi bất thường với cấu hình này.';
    row.append(cell);
    $('#resultRows').append(row);
  }
  $('#pageInfo').textContent = records.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, records.length)} / ${records.length} bản ghi` : '0 bản ghi';
  $('#prevPage').disabled = page === 0;
  $('#nextPage').disabled = (page + 1) * pageSize >= records.length;
}

async function analyze() {
  if (!dataset || busy) return;
  showError();
  try {
    const fields = selectedFields();
    const points = toPoints(dataset, fields);
    const config = { trees: Number($('#trees').value), sampleSize: Number($('#sampleSize').value), contamination: Number($('#contamination').value) };
    clearResult();
    setBusy(true);
    setFlow(1, 1, 30);
    $('#inputStatus').textContent = 'Đang gửi vector tới bộ tính toán local…';
    const response = await fetch('/api/isolation-forest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points, config }) });
    const data = await readAnalysis(response, (event) => {
      if (event.stage === 'normalize') { setFlow(1, 1, 40); $('#inputStatus').textContent = 'Đã chuẩn hóa vector số.'; }
      if (event.stage === 'forest') { setFlow(2, 2, 75); $('#inputStatus').textContent = `Đã dựng ${config.trees} cây cô lập.`; }
      if (event.stage === 'score') { setFlow(3, 3, 95); $('#inputStatus').textContent = `Đã chấm ${points.length} bản ghi.`; }
    });
    result = {
      fileName: dataset.fileName, ...data, features: fields,
      results: data.results.map((row) => ({ ...row, input: dataset.rows[row.rowIndex] })),
    };
    $('#totalMetric').textContent = result.summary.total;
    $('#normalMetric').textContent = result.summary.normal;
    $('#anomalyMetric').textContent = result.summary.anomalies;
    $('#scoreMetric').textContent = result.summary.maxScore.toFixed(4);
    $('#resultMeta').textContent = `${dataset.fileName} · ${config.trees} cây · ${result.configuration.sampleSize} mẫu/cây · ${(result.summary.durationMs / 1000).toFixed(2)} s`;
    $('#inputStatus').textContent = `Hoàn tất: ${result.summary.total} bản ghi, ${result.summary.anomalies} bất thường.`;
    $('#runBadge').textContent = 'Đã trả kết quả';
    $('#runBadge').className = 'status-badge is-complete';
    $('#resultContent').hidden = false;
    $('#emptyResult').hidden = true;
    $('#downloadResult').disabled = false;
    $('#treeExplorerMeta').textContent = `${result.treeTrace.sampleIndices.length} điểm được lấy mẫu · ${result.treeTrace.steps.length} nhánh đầu theo thứ tự tầng`;
    if (result.treeTrace.steps.length) {
      $('#cutSlider').max = result.treeTrace.steps.length - 1;
      $('#treeContent').hidden = false;
      $('#emptyTree').hidden = true;
      renderTreeStep($('#treeExplorer'), result, treeStep);
    } else {
      $('#emptyTree span').textContent = 'Các điểm mẫu trùng nhau nên cây đầu tiên không có nhánh cắt.';
    }
    setFlow(4, -1, 100);
    renderTable();
    previewRow([...result.results].sort((a, b) => b.score - a.score)[0]);
  } catch (error) {
    showError(error.message);
    $('#inputStatus').textContent = 'Phân tích chưa hoàn tất.';
    $('#runBadge').textContent = 'Cần kiểm tra dữ liệu';
    $('#runBadge').className = 'status-badge';
    setFlow(dataset ? 1 : 0);
  } finally { setBusy(false); }
}

$('#fileInput').addEventListener('change', (event) => { loadFile(event.target.files[0]); event.target.value = ''; });
$('#sampleButton').addEventListener('click', async () => {
  const version = ++fileVersion;
  dataset = undefined;
  clearResult();
  $('#analyzeButton').disabled = true;
  try {
    const response = await fetch('/sample-data.json');
    if (!response.ok) throw new Error('Không tải được dữ liệu mẫu.');
    const text = await response.text();
    if (version === fileVersion && !busy) loadText(text, 'sample-data.json');
  } catch (error) { showError(error.message); }
});
$('#fieldChoices').addEventListener('change', validateSelection);
for (const selector of ['#trees', '#sampleSize', '#contamination']) $(selector).addEventListener('change', validateSelection);
$('#analyzeButton').addEventListener('click', analyze);
$('#onlyAnomalies').addEventListener('change', () => { page = 0; renderTable(); });
$('#prevPage').addEventListener('click', () => { page -= 1; renderTable(); });
$('#nextPage').addEventListener('click', () => { page += 1; renderTable(); });
$('#previousCut').addEventListener('click', () => { treeStep -= 1; renderTreeStep($('#treeExplorer'), result, treeStep); });
$('#nextCut').addEventListener('click', () => { treeStep += 1; renderTreeStep($('#treeExplorer'), result, treeStep); });
$('#cutSlider').addEventListener('input', (event) => { treeStep = Number(event.target.value); renderTreeStep($('#treeExplorer'), result, treeStep); });
$('#downloadResult').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = dataset.fileName.replace(/\.json$/i, '') + '-isolation-results.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
for (const name of ['dragenter', 'dragover']) $('#dropZone').addEventListener(name, (event) => {
  event.preventDefault();
  if (!busy) $('#dropZone').classList.add('is-dragover');
});
for (const name of ['dragleave', 'drop']) $('#dropZone').addEventListener(name, (event) => {
  event.preventDefault();
  $('#dropZone').classList.remove('is-dragover');
  if (name === 'drop' && !busy) loadFile(event.dataTransfer.files[0]);
});
setFlow(0);
