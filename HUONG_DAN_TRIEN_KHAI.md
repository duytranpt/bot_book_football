# Hướng dẫn triển khai — Đặt sân bóng đá 7 người

Kiến trúc: **GitHub Pages (frontend tĩnh)** + **Google Apps Script (backend)** + **Google Sheet (database)**. Toàn bộ miễn phí, không cần thuê server.

## Bước 1 — Tạo backend (Google Apps Script + Sheet)

1. Vào [sheets.google.com](https://sheets.google.com), tạo 1 Sheet mới (tên gì cũng được, ví dụ "DB Đặt Sân").
2. Menu **Tiện ích mở rộng > Apps Script**.
3. Xoá hết code mẫu trong `Code.gs`, dán toàn bộ nội dung file `backend/Code.gs` (đã cung cấp) vào.
4. Bấm biểu tượng ⚙️ **Project Settings** (bên trái) → mục **Time zone**, chọn **`Asia/Ho_Chi_Minh`** (rất quan trọng, nếu không tính giờ đặt/hủy sẽ sai lệch).
5. Bấm **Deploy > New deployment**.
   - Chọn loại: **Web app**
   - Description: tuỳ ý
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Bấm **Deploy**, Google sẽ hỏi cấp quyền — bấm **Authorize access**, chọn tài khoản, bấm **Advanced > Go to (tên project) (unsafe)** nếu có cảnh báo, rồi **Allow**.
7. Copy **Web app URL** (dạng `https://script.google.com/macros/s/XXXX/exec`) — đây là `SCRIPT_URL`.

> Lưu ý: mỗi lần bạn sửa code trong Apps Script, phải **Deploy > Manage deployments > sửa (bút chì) > New version > Deploy** thì thay đổi mới có hiệu lực trên URL cũ.

## Bước 2 — Gắn URL vào frontend

Mở file `index.html`, tìm dòng:
```js
const SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
```
Thay bằng URL vừa copy ở Bước 1.

Đồng thời sửa các thông tin liên hệ trong phần `<div class="hero">`:
- Địa chỉ sân (link Google Maps)
- Số điện thoại đặt sân

## Bước 3 — Đưa lên GitHub Pages

1. Tạo 1 repo GitHub mới (public), ví dụ `dat-san-bong`.
2. Upload file `index.html` (đã sửa URL) vào repo, ở thư mục gốc.
3. Vào **Settings > Pages** của repo → Source chọn nhánh `main`, thư mục `/root` → Save.
4. Sau vài phút, trang sẽ có ở `https://<username>.github.io/<ten-repo>/`.

## Cấu trúc dữ liệu trong Sheet

Sheet `Bookings` được tự động tạo với các cột:

| id | day | hour | field | teamName | phone | note | idempotencyKey | status | createdAt | cancelledAt |
|---|---|---|---|---|---|---|---|---|---|---|

- `status` = `active` hoặc `cancelled`
- Bạn có thể mở sheet này để xem/thống kê lịch đặt trực tiếp, không cần công cụ khác.

## Các quy tắc nghiệp vụ đã cài sẵn (chỉnh trong cả 2 file `index.html` và `Code.gs` — 2 nơi phải khớp nhau)

| Quy tắc | Hằng số | Giá trị mặc định |
|---|---|---|
| Giờ mở sân | `OPEN_MIN` | 06:00 |
| Thời lượng 1 trận | `MATCH_DURATION` | 90 phút |
| Giờ trận cuối kết thúc | `LAST_END_MIN` | 22:30 |
| Đặt trước tối thiểu | `MIN_LEAD_MINUTES` | 60 phút |
| Hủy trước tối thiểu | `CANCEL_MIN_HOURS` | 4 tiếng |
| Số sân | `FIELDS` | 5 sân |

→ Với cấu hình mặc định, mỗi ngày/sân có **11 khung giờ**: 06:00–07:30, 07:30–09:00, ..., 21:00–22:30.

## Cơ chế chống trùng lịch (đáng chú ý)

- Mỗi khung giờ/sân chỉ 1 đội được giữ (kiểm tra ở backend, có `LockService` khoá khi ghi để tránh 2 người bấm đặt cùng lúc bị trùng).
- Mỗi lượt đặt có 1 `idempotencyKey` (UUID) sinh ở trình duyệt — nếu mạng chập chờn khiến JS tự gửi lại request, backend nhận diện key trùng và không tạo bản ghi thứ 2.
- Giao tiếp frontend↔backend dùng JSONP (không phải fetch chuẩn) vì Apps Script Web App không set CORS header cho phép gọi trực tiếp từ domain khác.

## Muốn mở rộng thêm

- Thông báo Zalo/Telegram khi có lịch mới → thêm 1 lệnh gọi webhook trong `handleSet()` của `Code.gs` (tương tự cách bạn từng làm với webhook Jenkins → Google Chat).
- Giá thuê sân theo khung giờ (giờ vàng đắt hơn) → thêm cột `price` và logic tính trong cả 2 file.
- Trang quản trị xem toàn bộ lịch → có thể đọc thẳng từ Google Sheet bằng Google Sheets API hoặc thêm `action=admin_list` có xác thực mật khẩu.
