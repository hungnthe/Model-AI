# Thuật toán phân tích Random Cut Forest

Ứng dụng dùng **Robust Random Cut Forest (RRCF)** trong chế độ phân tích theo lô. Mỗi lần bấm **Phân tích JSON**, mô hình tạo một forest mới từ chính tệp được tải lên. Đây là phát hiện **bất thường thống kê**, không phải bộ phân loại sự cố an ninh.

## 1. Đầu vào

Ví dụ `hosteye-rcf-input.json` có mảng `data`, mỗi phần tử là một log. Giao diện giữ `id`, `timestamp`, `computer`, `channel`, `event_id`, `level` làm thông tin đối chiếu. Chỉ những trường số được người dùng chọn mới đưa vào mô hình, mặc định gồm:

- `event_age_seconds`: độ trễ giữa thời điểm sự kiện và lúc thu nhận.
- `message_length`: độ dài nội dung log đã xuất.
- `is_error`, `is_sysmon`, `is_firewall`, `has_dns_query`, `has_process_path`, `has_network_destination`: các cờ 0/1.

Không tự suy luận từ `id` hay `event_id` vì chúng là mã định danh, không phải đại lượng liên tục. Bộ phân tích yêu cầu 3-2000 bản ghi, 1-20 trường số, mọi bản ghi có đủ trường đã chọn và giá trị phải hữu hạn.

## 2. Chuẩn hóa

Với mỗi chiều `j`, tính median `m_j` và khoảng tứ phân vị `IQR_j = Q3_j - Q1_j` trên toàn bộ tệp. Vector chuẩn hóa là:

```text
z_ij = (x_ij - m_j) / IQR_j       nếu IQR_j > 0
z_ij = (x_ij - m_j)               nếu IQR_j = 0
```

Cột hằng số vì vậy trở thành 0. Với cờ hiếm 0/1 có IQR bằng 0, giá trị 1 vẫn khác 0. Median và IQR được tính **lại cho mỗi tệp**, nên điểm của hai tệp khác nhau không nên so trực tiếp.

## 3. Dựng forest

Mặc định dựng 32 cây; mỗi cây lấy ngẫu nhiên không hoàn lại tối đa 128 bản ghi, với seed cố định 42 để tái lập kết quả. RRCF chọn chiều cắt theo độ rộng hộp bao và vị trí cắt ngẫu nhiên trong chiều đó. Các cây được dựng từ các mẫu khác nhau để điểm số ít phụ thuộc vào một cách phân hoạch đơn lẻ.

## 4. Chấm điểm

Với mỗi bản ghi `i` và cây `t`:

1. Nếu `i` có trong mẫu dựng cây, tính `CoDisp_t(i)` trực tiếp.
2. Nếu `i` không có trong mẫu, chèn tạm vector của nó vào cây, tính CoDisp, rồi xóa khỏi cây để không ảnh hưởng bản ghi tiếp theo.
3. Lấy trung bình các cây: `score(i) = sum_t CoDisp_t(i) / số_cây`.

CoDisp (collusive displacement) biểu thị mức thay đổi cấu trúc cây khi loại bỏ điểm hoặc nhóm điểm liên quan. **Score càng cao chỉ có nghĩa điểm càng khác cấu trúc mẫu tham chiếu**; nó không phải xác suất tấn công, mức độ nghiêm trọng, hay điểm tin cậy 0-100.

## 5. Trả kết quả

Ứng dụng gắn cờ `isAnomaly = (score >= threshold)`, với ngưỡng mặc định 10 do người dùng đặt, không tự hiệu chỉnh theo tỷ lệ báo động. Kết quả xuất JSON giữ bản ghi đầu vào, vector gốc, vector chuẩn hóa, score, cờ bất thường, cấu hình và thống kê tổng.

```text
JSON -> kiểm tra -> chọn trường số -> median/IQR -> lấy mẫu -> dựng RRCF
     -> CoDisp từng cây -> trung bình -> so ngưỡng -> ghép log gốc -> JSON kết quả
```

## Giới hạn cần nhớ

- Tệp HostEye hiện tại là **mẫu log phân tầng**, không đại diện cho toàn bộ luồng sự kiện. Tỷ lệ bất thường trong mẫu không phải tỷ lệ bất thường của hệ thống.
- Một log lỗi (`is_error = 1`) hoặc một điểm CoDisp cao không tự chứng minh sự cố bảo mật. Cần điều tra cùng thời gian, máy, event ID, ngữ cảnh và baseline thực tế.
- Cách hiện tại là batch, không tự học liên tục theo thời gian, không phân nhóm riêng theo máy/kênh và không dùng chuỗi thời gian hoặc nội dung `message` để hiểu ngữ nghĩa sự kiện.
