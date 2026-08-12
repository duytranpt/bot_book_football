/**
 * ĐẶT SÂN BÓNG ĐÁ 7 NGƯỜI — BACKEND (Google Apps Script + Google Sheet)
 * ---------------------------------------------------------------------
 * Cách dùng:
 * 1. Tạo 1 Google Sheet mới (trống cũng được, script sẽ tự tạo sheet "Bookings").
 * 2. Trong Sheet: Tiện ích mở rộng > Apps Script. Xoá code mẫu, dán toàn bộ file này vào.
 * 3. Deploy > New deployment > chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL /exec được cấp, dán vào biến SCRIPT_URL trong index.html.
 * 5. (Quan trọng) Project Settings > đặt Time zone = Asia/Ho_Chi_Minh
 *    để giờ tính đúng theo giờ Việt Nam.
 */

// ─── CẤU HÌNH (PHẢI KHỚP VỚI index.html) ──────────────────────────────
const SHEET_NAME = 'Bookings';
const FIELDS = ['Sân 1', 'Sân 2', 'Sân 3', 'Sân 4', 'Sân 5'];
const OPEN_MIN = 6 * 60;          // 06:00
const MATCH_DURATION = 90;        // phút / trận
const LAST_END_MIN = 22 * 60 + 30; // 22:30
const MIN_LEAD_MINUTES = 60;      // phải đặt trước tối thiểu 1 tiếng
const CANCEL_MIN_HOURS = 4;       // phải hủy trước tối thiểu 4 tiếng

// ─── CẤU HÌNH TELEGRAM NOTIFICATIONS ─────────────────────────────────────
// Token & chat ID được lưu trong Script Properties (không nằm trong code).
// Trong Apps Script editor: Project Settings → Script Properties → Add:
//   Key: TELEGRAM_BOT_TOKEN  | Value: token từ @BotFather
//   Key: TELEGRAM_CHAT_ID    | Value: chat ID (lấy qua /getUpdates)
// Để tắt thông báo, không thêm 2 key trên.

// Cột trong sheet: A=id B=day C=hour D=field E=teamName F=phone G=note
//                  H=idempotencyKey I=status J=createdAt K=cancelledAt
const COL = { ID:0, DAY:1, HOUR:2, FIELD:3, TEAM:4, PHONE:5, NOTE:6, IKEY:7, STATUS:8, CREATED:9, CANCELLED:10 };

function doGet(e) {
  const action = (e.parameter.action || '').trim();
  const callback = e.parameter.callback || 'callback';
  let result;
  try {
    switch (action) {
      case 'availability': result = handleAvailability(); break;
      case 'set':          result = handleSet(e.parameter); break;
      case 'lookup':       result = handleLookup(e.parameter); break;
      case 'cancel':       result = handleCancel(e.parameter); break;
      default:              result = { success: false, error: 'Hành động không hợp lệ' };
    }
  } catch (err) {
    result = { success: false, error: 'Lỗi hệ thống: ' + err.message };
  }
  const body = callback + '(' + JSON.stringify(result) + ')';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ─── HELPERS ───────────────────────────────────────────────────────────
function fmtHM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return ('' + h).padStart(2, '0') + ':' + ('' + m).padStart(2, '0');
}
function generateValidHours() {
  const hours = [];
  let start = OPEN_MIN;
  while (start + MATCH_DURATION <= LAST_END_MIN) {
    hours.push(fmtHM(start));
    start += MATCH_DURATION;
  }
  return hours;
}
const VALID_HOURS = generateValidHours();

function normalizePhone(raw) {
  if (!raw) return raw;
  let p = String(raw).trim().replace(/[\s.\-]/g, '');
  if (p.indexOf('+84') === 0) p = '0' + p.slice(3);
  else if (p.indexOf('84') === 0 && p.length >= 10) p = '0' + p.slice(2);
  return p;
}

function sendTelegram(text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: Number(chatId), text: text })
    });
  } catch (e) { console.warn('Telegram notify failed:', e.message); }
}

function parseSlotDateTime(day, hour) {
  const dp = String(day).split('-').map(Number);
  const hp = String(hour).split(':').map(Number);
  if (dp.length !== 3 || hp.length !== 2) return null;
  return new Date(dp[0], dp[1] - 1, dp[2], hp[0], hp[1], 0);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['id','day','hour','field','teamName','phone','note','idempotencyKey','status','createdAt','cancelledAt']);
  }
  return sheet;
}

// ─── ACTION: availability ─────────────────────────────────────────────
// Chỉ trả về day/hour/field của các lịch ĐANG active — KHÔNG trả tên/SĐT
// của khách để bảo vệ thông tin cá nhân của các đội khác.
function handleAvailability() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.STATUS] === 'active') {
      out.push({ day: formatDayCell(row[COL.DAY]), hour: formatHourCell(row[COL.HOUR]), field: row[COL.FIELD] });
    }
  }
  return out;
}

function formatDayCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  return String(v);
}
function formatHourCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'HH:mm');
  return String(v);
}

// ─── ACTION: set (đặt sân) ─────────────────────────────────────────────
function handleSet(p) {
  const required = ['day', 'hour', 'field', 'teamName', 'phone', 'idempotencyKey'];
  for (const r of required) {
    if (!p[r]) return { success: false, error: 'Thiếu thông tin: ' + r };
  }
  if (FIELDS.indexOf(p.field) === -1) return { success: false, error: 'Sân không hợp lệ' };
  if (VALID_HOURS.indexOf(p.hour) === -1) return { success: false, error: 'Khung giờ không hợp lệ' };

  const phone = normalizePhone(p.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { success: false, error: 'Số điện thoại không hợp lệ' };

  const slotStart = parseSlotDateTime(p.day, p.hour);
  if (!slotStart) return { success: false, error: 'Ngày/giờ không hợp lệ' };
  const now = new Date();
  if (slotStart.getTime() - now.getTime() < MIN_LEAD_MINUTES * 60000) {
    return { success: false, error: 'Vui lòng đặt trước ít nhất ' + (MIN_LEAD_MINUTES / 60) + ' tiếng so với giờ đá' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();

    // Idempotency: nếu request này đã từng được ghi thành công (do JSONP
    // retry gửi lại với cùng key), trả về thành công luôn, không ghi trùng.
    for (let i = 1; i < data.length; i++) {
      if (data[i][COL.IKEY] === p.idempotencyKey) {
        return { success: true, id: data[i][COL.ID], duplicate: true };
      }
    }

    // Kiểm tra khung giờ/sân đã có đội khác đặt chưa
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[COL.STATUS] === 'active' &&
          formatDayCell(row[COL.DAY]) === p.day &&
          formatHourCell(row[COL.HOUR]) === p.hour &&
          row[COL.FIELD] === p.field) {
        return { success: false, error: 'Sân này khung giờ đã có đội đặt, vui lòng chọn khung giờ khác' };
      }
    }

    const id = Utilities.getUuid();
    sheet.appendRow([
      id, p.day, p.hour, p.field, p.teamName, "'" + phone, p.note || '',
      p.idempotencyKey, 'active', new Date(), ''
    ]);
    // Thông báo Telegram
    const [sh, sm] = p.hour.split(':').map(Number);
    sendTelegram(
      '🔔 Có đội đặt sân mới!\n\n' +
      '🏟️ Sân: ' + p.field + '\n' +
      '📅 Ngày: ' + p.day + '\n' +
      '🕐 Giờ: ' + p.hour + ' – ' + fmtHM(sh * 60 + sm + MATCH_DURATION) + '\n' +
      '👤 Đội: ' + p.teamName + '\n' +
      '📞 SĐT: ' + phone +
      (p.note ? '\n📝 Ghi chú: ' + p.note : '')
    );
    return { success: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

// ─── ACTION: lookup (tra cứu theo SĐT) ─────────────────────────────────
function handleLookup(p) {
  if (!p.phone) return { success: false, error: 'Thiếu số điện thoại' };
  const phone = normalizePhone(p.phone);
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const bookings = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.STATUS] === 'active' && normalizePhone(row[COL.PHONE]) === phone) {
      bookings.push({
        id: row[COL.ID],
        day: formatDayCell(row[COL.DAY]),
        hour: formatHourCell(row[COL.HOUR]),
        field: row[COL.FIELD],
        teamName: row[COL.TEAM]
      });
    }
  }
  bookings.sort((a, b) => (a.day + a.hour).localeCompare(b.day + b.hour));
  return { success: true, bookings: bookings };
}

// ─── ACTION: cancel (hủy lịch) ──────────────────────────────────────────
function handleCancel(p) {
  if (!p.id || !p.phone) return { success: false, error: 'Thiếu thông tin để hủy lịch' };
  const phone = normalizePhone(p.phone);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[COL.ID] === p.id) {
        if (row[COL.STATUS] !== 'active') {
          return { success: false, error: 'Lịch này đã được hủy trước đó' };
        }
        if (normalizePhone(row[COL.PHONE]) !== phone) {
          return { success: false, error: 'Số điện thoại không khớp với lịch đã đặt' };
        }
        const day = formatDayCell(row[COL.DAY]);
        const hour = formatHourCell(row[COL.HOUR]);
        const slotStart = parseSlotDateTime(day, hour);
        const now = new Date();
        if (slotStart && (slotStart.getTime() - now.getTime()) < CANCEL_MIN_HOURS * 3600000) {
          return { success: false, error: 'Chỉ có thể hủy lịch trước tối thiểu ' + CANCEL_MIN_HOURS + ' tiếng so với giờ đá' };
        }
        sheet.getRange(i + 1, COL.STATUS + 1).setValue('cancelled');
        sheet.getRange(i + 1, COL.CANCELLED + 1).setValue(new Date());
        // Thông báo Telegram
        const [ch, cmm] = hour.split(':').map(Number);
        sendTelegram(
          '❌ Lịch đặt bị hủy!\n\n' +
          '🏟️ Sân: ' + row[COL.FIELD] + '\n' +
          '📅 Ngày: ' + day + '\n' +
          '🕐 Giờ: ' + hour + ' – ' + fmtHM(ch * 60 + cmm + MATCH_DURATION) + '\n' +
          '👤 Đội: ' + row[COL.TEAM] + '\n' +
          '📞 SĐT: ' + normalizePhone(row[COL.PHONE])
        );
        return { success: true };
      }
    }
    return { success: false, error: 'Không tìm thấy lịch đặt' };
  } finally {
    lock.releaseLock();
  }
}
