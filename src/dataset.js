export const MAX_RECORDS = 2000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const metadataFields = new Set(['id', '_id', 'index', 'timestamp', 'time', 'date', 'label']);

export function parseDataset(text, fileName = 'data.json') {
  let document;
  try { document = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON không hợp lệ. Kiểm tra dấu phẩy, dấu ngoặc và dấu nháy kép.'); }
  const rows = Array.isArray(document) ? document : document?.data;
  if (!Array.isArray(rows)) throw new Error('Cần một mảng JSON hoặc object có trường "data" là mảng.');
  if (rows.length < 3 || rows.length > MAX_RECORDS) throw new Error(`Cần từ 3 đến ${MAX_RECORDS} bản ghi.`);
  const vectors = Array.isArray(rows[0]);
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) !== vectors)) {
    throw new Error('Các bản ghi phải cùng là object hoặc cùng là mảng số.');
  }
  let fields;
  if (vectors) {
    if (!rows[0].length || rows.some((row) => row.length !== rows[0].length)) {
      throw new Error('Mỗi vector phải có cùng số chiều và không được rỗng.');
    }
    fields = rows[0].map((_, index) => `x${index + 1}`);
  } else {
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    fields = keys.filter((key) => !metadataFields.has(key.toLowerCase()) && rows.some((row) => typeof row[key] === 'number'));
  }
  if (!fields.length) throw new Error('Không tìm thấy trường số để phân tích. ID và thời gian không được dùng làm đặc trưng.');
  return { fileName, rows, fields, vectors };
}

export function toPoints(dataset, selectedFields) {
  if (!selectedFields.length || selectedFields.length > 20) throw new Error('Chọn từ 1 đến 20 trường số.');
  return dataset.rows.map((row, rowIndex) => selectedFields.map((field) => {
    const value = dataset.vectors ? row[dataset.fields.indexOf(field)] : row[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e100) {
      throw new Error(`Bản ghi ${rowIndex + 1}, trường "${field}": cần số hữu hạn, không nhận null hoặc chuỗi.`);
    }
    return value;
  }));
}

export async function readAnalysis(response, onProgress) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Không xử lý được yêu cầu (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result;
  const accept = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'result') result = event.data;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(accept);
    }
    pending += decoder.decode();
    accept(pending);
  } finally { reader.releaseLock(); }
  if (!result) throw new Error('Máy chủ chưa trả kết quả. Vui lòng thử lại.');
  return result;
}
