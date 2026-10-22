import './styles.css';
import { createIcons, Workflow, FileJson2, Upload, FlaskConical, Download, Play, Pause, ArrowUpRight, Box, RotateCcw, ScanLine, ChevronLeft, ChevronRight } from 'lucide';
import { parseDataset, toPoints, readAnalysis, MAX_FILE_BYTES } from './dataset.js';
import { createScene } from './scene.js';

const $ = (selector) => document.querySelector(selector);
const icons = { Workflow, FileJson2, Upload, FlaskConical, Download, Play, Pause, ArrowUpRight, Box, RotateCcw, ScanLine, ChevronLeft, ChevronRight };
const drawIcons = () => createIcons({ icons });
let scene;
try { scene = createScene($('#scene')); }
catch (error) {
  console.warn('WebGL:', error);
  $('#sceneFallback').hidden = false;
  $('#pauseScene').disabled = true;
  $('#resetScene').disabled = true;
}

const modes = {
  stream: ['JSON → vector số', 'Mỗi bản ghi trở thành vector từ các trường đã chọn. ID, nhãn và thời gian được giữ trong dữ liệu gốc. Giá trị thiếu, null và chuỗi không được tự đổi thành số.'],
  cut: ['Random cut → forest', 'Chuẩn hóa bằng median / IQR. Mỗi cây lấy mẫu từ tệp, chọn chiều cắt theo độ rộng bounding box rồi cắt ngẫu nhiên trên chiều đó. Mô hình 3D minh họa cấu trúc, không hiển thị toàn bộ số cây.'],
  score: ['Forest → mean CoDisp', 'CoDisp đo mức thay đổi cấu trúc khi loại bỏ một điểm cùng nhóm liên quan. Lấy trung bình CoDisp qua các cây; score cao cho thấy điểm khác biệt. Đây không phải công thức độ sâu của Isolation Forest.'],
  deploy: ['Score → kết quả JSON', 'So sánh score với ngưỡng: score ≥ ngưỡng thì isAnomaly = true. Ghép lại bản ghi gốc và xuất JSON. Phiên này xử lý batch trên máy local; hệ thống stream cần cập nhật mẫu theo thời gian.'],
};
let dataset;
let result;
let busy = false;
let page = 0;
let selectedRow;
let fileVersion = 0;
const pageSize = 8;

function updateMode(mode) {
  $('#modeTitle').textContent = modes[mode][0];
  $('#modeText').textContent = modes[mode][1];
  document.querySelectorAll('.mode').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  scene?.setMode(mode);
}
function showError(message = '') {
  $('#errorMessage').textContent = message;
  $('#errorMessage').hidden = !message;
}
function setFlow(done, active = -1, progress = done / 6 * 100) {
  document.querySelectorAll('#pipeline li').forEach((step, index) => {
    step.classList.toggle('is-done', index < done);
    step.classList.toggle('is-active', index === active);
  });
  $('#flowProgress').textContent = `${done} / 6 bước`;
  $('#analysisProgress').value = progress;
}
function selectedFields() { return [...document.querySelectorAll('#fieldChoices input:checked')].map((input) => input.value); }
function clearResult() {
  result = undefined;
  page = 0;
  selectedRow = undefined;
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
  scene?.setData(dataset?.rows.length || 0);
}
function validateSelection() {
  showError();
  clearResult();
  try {
    if (!dataset) return;
    const fields = selectedFields();
    toPoints(dataset, fields);
    $('#analyzeButton').disabled = false;
    $('#stepRead').textContent = `${dataset.rows.length} bản ghi`;
    $('#stepValidate').textContent = `${fields.length} trường số`;
    $('#inputStatus').textContent = `${dataset.rows.length} bản ghi hợp lệ · ${fields.length} trường số.`;
    $('#flowDescription').textContent = `Bản ghi → [${fields.join(', ')}] → chuẩn hóa median / IQR → forest → CoDisp → JSON.`;
    setFlow(2);
  } catch (error) {
    showError(error.message);
    $('#analyzeButton').disabled = true;
    $('#inputStatus').textContent = 'Dữ liệu cần kiểm tra.';
    setFlow(1, 1);
  }
}
function loadText(text, name) {
  dataset = undefined;
  clearResult();
  $('#fieldChoices').replaceChildren();
  $('#fieldSection').hidden = true;
  $('#inputPreview').textContent = '[]';
  $('#fileName').textContent = name;
  $('#fileMeta').textContent = 'Đang kiểm tra';
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
    updateMode('stream');
    validateSelection();
  } catch (error) {
    showError(error.message);
    $('#fileMeta').textContent = 'Tệp chưa hợp lệ';
    $('#inputStatus').textContent = 'Chưa có dữ liệu hợp lệ.';
    $('#inputPreviewMeta').textContent = 'Tệp chưa hợp lệ';
    setFlow(0);
  }
}
async function loadFile(file) {
  if (!file || busy) return;
  const version = ++fileVersion;
  dataset = undefined;
  clearResult();
  $('#analyzeButton').disabled = true;
  $('#inputStatus').textContent = 'Đang đọc tệp…';
  if (file.size > MAX_FILE_BYTES) {
    loadText('', file.name);
    return showError('Tệp vượt quá 5 MB.');
  }
  try {
    const text = await file.text();
    if (version === fileVersion) loadText(text, file.name);
  } catch { showError('Không đọc được tệp JSON. Hãy chọn lại tệp.'); }
}

function setBusy(value) {
  busy = value;
  for (const selector of ['#fileInput', '#sampleButton', '#trees', '#sampleSize', '#threshold']) $(selector).disabled = value;
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
    const cells = [label, `[${record.vector.join(', ')}]`, record.score.toFixed(3), record.isAnomaly ? 'Bất thường' : 'Bình thường'];
    cells.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 3) cell.className = `result-tag${record.isAnomaly ? ' is-anomaly' : ''}`;
      row.append(cell);
    });
    row.addEventListener('click', () => previewRow(record));
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') previewRow(record); });
    $('#resultRows').append(row);
  });
  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'Không có bản ghi bất thường với ngưỡng này.';
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
    const config = { trees: Number($('#trees').value), sampleSize: Number($('#sampleSize').value), threshold: Number($('#threshold').value) };
    if (!Number.isFinite(config.threshold) || config.threshold <= 0 || config.threshold > 10000) throw new Error('Ngưỡng CoDisp phải lớn hơn 0 và không quá 10000.');
    clearResult();
    setBusy(true);
    setFlow(2, 2, 34);
    $('#inputStatus').textContent = 'Đang gửi vector tới bộ tính toán local…';
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points, config }) });
    const data = await readAnalysis(response, (event) => {
      if (event.stage === 'normalize') { setFlow(3, 3, 40); updateMode('cut'); }
      if (event.stage === 'forest') {
        setFlow(3, 3, 40 + event.completed / event.total * 25);
        updateMode('cut');
        $('#inputStatus').textContent = `Đã tạo ${event.completed} / ${event.total} cây từ dữ liệu JSON.`;
      }
      if (event.stage === 'score') {
        setFlow(4, 4, 65 + event.completed / event.total * 30);
        updateMode('score');
        $('#stepScore').textContent = `${event.completed} / ${event.total} cây`;
        $('#inputStatus').textContent = `Đã chấm ${points.length} bản ghi qua ${event.completed} / ${event.total} cây.`;
      }
    });
    result = {
      fileName: dataset.fileName,
      ...data,
      features: fields,
      results: data.results.map((row) => ({ ...row, input: dataset.rows[row.rowIndex], threshold: config.threshold })),
    };
    $('#totalMetric').textContent = result.summary.total;
    $('#normalMetric').textContent = result.summary.normal;
    $('#anomalyMetric').textContent = result.summary.anomalies;
    $('#scoreMetric').textContent = result.summary.maxScore.toFixed(2);
    $('#resultMeta').textContent = `${dataset.fileName} · ${config.trees} cây · ${result.configuration.sampleSize} mẫu/cây · ${(result.summary.durationMs / 1000).toFixed(2)} s`;
    $('#inputStatus').textContent = `Hoàn tất: ${result.summary.total} bản ghi, ${result.summary.anomalies} bất thường.`;
    $('#runBadge').textContent = 'Đã trả kết quả';
    $('#runBadge').className = 'status-badge is-complete';
    $('#resultContent').hidden = false;
    $('#emptyResult').hidden = true;
    $('#downloadResult').disabled = false;
    $('#flowDescription').textContent = `${points.length} bản ghi → ${fields.length} trường số → ${config.trees} cây → mean CoDisp → ${result.summary.anomalies} bất thường (score ≥ ${config.threshold}).`;
    setFlow(6, -1, 100);
    updateMode('deploy');
    scene?.setData(points.length, result.results);
    renderTable();
    previewRow([...result.results].sort((a, b) => b.score - a.score)[0]);
  } catch (error) {
    showError(error.message);
    $('#inputStatus').textContent = 'Phân tích chưa hoàn tất.';
    $('#runBadge').textContent = 'Cần kiểm tra dữ liệu';
    $('#runBadge').className = 'status-badge';
    setFlow(dataset ? 2 : 0);
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
for (const selector of ['#trees', '#sampleSize', '#threshold']) $(selector).addEventListener('change', () => {
  if (dataset) validateSelection();
  $('#stepForest').textContent = `${$('#trees').value} random cut trees`;
});
$('#analyzeButton').addEventListener('click', analyze);
$('#onlyAnomalies').addEventListener('change', () => { page = 0; renderTable(); });
$('#prevPage').addEventListener('click', () => { page -= 1; renderTable(); });
$('#nextPage').addEventListener('click', () => { page += 1; renderTable(); });
document.querySelectorAll('.mode').forEach((button) => button.addEventListener('click', () => updateMode(button.dataset.mode)));
$('#downloadResult').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = dataset.fileName.replace(/\.json$/i, '') + '-results.json';
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
function renderPauseButton() {
  const paused = scene?.paused;
  $('#pauseScene').innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}"></i>`;
  $('#pauseScene').title = paused ? 'Tiếp tục chuyển động' : 'Tạm dừng chuyển động';
  $('#pauseScene').setAttribute('aria-label', $('#pauseScene').title);
  drawIcons();
}
$('#pauseScene').addEventListener('click', () => { scene?.togglePause(); renderPauseButton(); });
$('#resetScene').addEventListener('click', () => scene?.reset());
updateMode('stream');
renderPauseButton();
