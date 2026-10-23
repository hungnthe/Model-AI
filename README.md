# Model AI / Anomaly Detection Lab

Trang Home chon giua Random Cut Forest va Isolation Forest. RCF co mo hinh 3D Three.js va bo tinh Python `rrcf`; Isolation Forest dung `scikit-learn` va hien thi nhanh cat cua cay dau tien.

Sau khi phan tich, bam **Xem cay** tren canh 3D de duyet cac nhanh cat cua cay RCF dau tien. Do thi chieu 2 chieu de quan sat; trace `q/p` va tap diem trai/phai lay tu cay that cua backend.

Mo ta chi tiet cac buoc tinh toan: [THUAT_TOAN.md](THUAT_TOAN.md).

## Chay tren Windows / PowerShell

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev -- --port 5173
```

Mo http://127.0.0.1:5173. Trang RCF o `/rcf.html`, Isolation Forest o `/isolation-forest.html`. Python duoc chay tu `.venv` boi Vite middleware,
khong can khoi dong backend rieng. Co the dat `RCF_PYTHON` de chi dinh Python khac.

## Input va output

Nhan mang object, object co `data` la mang, hoac ma tran so:

```json
{"data":[{"id":"a","value":20},{"id":"b","value":21},{"id":"c","value":90}]}
```

File mau: `public/sample-data.json`. Tu 3 den 2000 ban ghi, toi da 5 MB,
tu 1 den 20 truong so. ID, timestamp, date, time, index, label la metadata.
Khong tu dong ep chuoi/null thanh so. Truong thieu se bao loi theo so ban ghi.

Ca hai luong: doc JSON -> kiem tra -> vector -> median/IQR -> forest
-> score -> so sanh nguong -> ghep lai du lieu goc -> tai JSON ket qua.

`POST /api/analyze` nhan `{points: number[][], config: {trees, sampleSize, threshold}}`.
Tra NDJSON: cac event `progress`, sau do `result` hoac `error`.
Frontend bo sung `input`, `features`, `fileName` vao ket qua xuat.

`POST /api/isolation-forest` nhan `{points: number[][], config: {trees, sampleSize, contamination}}` va tra cung dinh dang NDJSON. Isolation Forest dung `score = -decision_function`, gan co khi `score > 0`. `contamination` dat nguong tren chinh tep phan tich, khong phai xac suat su co. Ca hai mo hinh deu dung lai dinh dang JSON dau vao va bo chon truong so.

`hosteye-rcf-input.json` la du lieu log noi bo duoc giu local, khong dua len Git. Co the chon tep nay trong giao dien Isolation Forest de chay tren 370 ban ghi va 8 truong so.

RCF phan tich **batch**, khong la he thong streaming online. Moi lan chay tao forest
moi voi seed 42; mau moi cay gioi han theo cau hinh. Diem ngoai mau duoc them
tam vao cay de tinh CoDisp, sau do loai bo. Gia tri trung duoc giu lai.
Chuan hoa duoc fit tren chinh tep hien tai. CoDisp khong phai xac suat;
nguong do nguoi dung chon, khong phai nguong thong ke tu hieu chinh.
Mo hinh 3D la minh hoa; so cay hien thi khong bang so cay tinh toan.

Isolation Forest cung chay batch voi seed 42. `contamination` la ty le dung de
dat nguong tren chinh tep dang fit; vi vay so ban ghi duoc gan co phu thuoc
vao tham so nay. `firstTreeDepth` chi mo ta cay dau tien; score tong hop tu
toan bo forest. Diem so cua hai mo hinh khong cung thang do.

Tham khao: https://klabum.github.io/rrcf/scoring-rctree.html
va https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html

## Kiem tra va build

```powershell
npm test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm run build
npm run preview -- --port 4173
```

API co trong ca Vite dev va preview. `dist` khong chay API neu chi host tinh;
trien khai production can backend Python/Node co xu ly process, timeout va
gioi han request tuong tu `vite.config.mjs`.
