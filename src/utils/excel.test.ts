import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  MONTH_MARKER_REGEX,
  matchMonthHeader,
  createRawWorkbookFromRows,
  parseClipboardToRawWorkbook,
  buildImportPreview,
  parseExcelWorkbook,
} from './excel';

async function runParserTests() {
  console.log('=== BẮT ĐẦU CHẠY BỘ TEST EXCEL PARSER ===\n');

  // ---------------------------------------------------------------------------
  // Test 1: Kiểm tra Regex & matchMonthHeader với tất cả các dạng mốc tháng
  // ---------------------------------------------------------------------------
  console.log('1. Kiểm tra nhận diện regex mốc tháng & logic cột số tiền trống/có giá trị...');

  const validMarkers: Array<{
    input: string;
    expectedMonth: number;
    expectedYear?: number;
  }> = [
    { input: 't4/2026', expectedMonth: 4, expectedYear: 2026 },
    { input: 't12/2025', expectedMonth: 12, expectedYear: 2025 },
    { input: 't1', expectedMonth: 1, expectedYear: undefined },
    { input: 't2', expectedMonth: 2, expectedYear: undefined },
    { input: 't3', expectedMonth: 3, expectedYear: undefined },
    { input: '9.2025', expectedMonth: 9, expectedYear: 2025 },
    { input: '10.2025', expectedMonth: 10, expectedYear: 2025 },
    { input: '11.2025', expectedMonth: 11, expectedYear: 2025 },
    { input: 'Tháng 9', expectedMonth: 9, expectedYear: undefined },
    { input: 'Tháng 9/2025', expectedMonth: 9, expectedYear: 2025 },
  ];

  for (const tc of validMarkers) {
    assert.equal(
      MONTH_MARKER_REGEX.test(tc.input),
      true,
      `MONTH_MARKER_REGEX phải match "${tc.input}"`
    );
    const res = matchMonthHeader(tc.input, '');
    assert.equal(res.isMonth, true, `matchMonthHeader("${tc.input}", "") phải trả về isMonth=true`);
    assert.equal(res.monthNum, tc.expectedMonth, `Tháng của "${tc.input}" phải là ${tc.expectedMonth}`);
    assert.equal(res.explicitYear, tc.expectedYear, `Năm của "${tc.input}" phải là ${tc.expectedYear}`);
  }

  // Rule 2: Nếu cột số tiền cùng dòng CÓ giá trị -> KHÔNG phải mốc tháng (vd ngày 10, số tiền 10)
  const expenseDay10 = matchMonthHeader('10', '10');
  assert.equal(
    expenseDay10.isMonth,
    false,
    'Khoản chi có ngày 10 và số tiền 10 KHÔNG được hiểu nhầm thành mốc tháng'
  );
  const markerWithAmount = matchMonthHeader('9.2025', '150');
  assert.equal(
    markerWithAmount.isMonth,
    false,
    'Dòng có cột số tiền khác rỗng KHÔNG được coi là dòng mốc tháng'
  );

  console.log('   -> PASS Test 1!\n');

  // ---------------------------------------------------------------------------
  // Test 2 (Bộ dữ liệu mẫu 1):
  // Dùng mốc dạng "9.2025" / "10.2025" xen các ngày lặp lại (22, 22, 23, 23...)
  // kết hợp kiểm tra cả ô ngày trống (forward-fill) và khoản chi ngày 10 số tiền 10
  // ---------------------------------------------------------------------------
  console.log('2. Kiểm tra Bộ dữ liệu mẫu 1: Mốc "9.2025" / "10.2025" xen các ngày lặp lại (22,22,23,23...)...');

  const sampleDataset1Rows: (string | number)[][] = [
    ['9.2025', '', ''],
    [22, 120, 'Ăn sáng đoàn công tác'],
    [22, 250, 'Taxi di chuyển nội thành'],
    [23, 180, 'Ăn trưa tiếp khách'],
    [23, 95, 'Mua nước uống & cà phê'],
    ['', 60, 'Gửi xe (ô ngày trống -> kế thừa ngày 23)'],
    ['10.2025', '', ''],
    [10, 10, 'Mua kẹo cao su (ngày 10, tiền 10 -> khoản chi bình thường)'],
    [22, 310, 'Vé tàu công tác'],
    [22, 140, 'Ăn tối tại ga'],
    [23, 450, 'Khách sạn lưu trú'],
    [23, 115, 'Ăn sáng trả phòng'],
  ];

  const wb1 = createRawWorkbookFromRows(sampleDataset1Rows, 'Dataset1_9.2025_10.2025.xlsx');
  const result1 = buildImportPreview(wb1, {
    startYear: 2024, // Cố tình truyền 2024 để chắc chắn parser lấy đúng năm 2025 từ "9.2025" và "10.2025"
    unitMode: 'thousand',
  });

  // Dòng "9.2025" và "10.2025" là mốc tháng nên không nằm trong danh sách khoản chi (chỉ có 10 khoản chi)
  assert.equal(result1.items.length, 10, 'Bộ mẫu 1 phải parse ra đúng 10 khoản chi (bỏ qua 2 dòng mốc tháng)');
  assert.deepEqual(
    result1.monthsFound,
    ['Tháng 9/2025', 'Tháng 10/2025'],
    'Bộ mẫu 1 phải nhận diện đúng 2 tháng: Tháng 9/2025 và Tháng 10/2025'
  );
  assert.equal(result1.warningCount, 0, 'Bộ mẫu 1 không được có cảnh báo giả khi ngày lặp lại 22,22,23,23');

  const expectedDates1 = [
    '22/09/2025',
    '22/09/2025',
    '23/09/2025',
    '23/09/2025',
    '23/09/2025', // forward-fill từ ngày 23 phía trên
    '10/10/2025', // ngày 10, số tiền 10 -> khoản chi bình thường trong tháng 10/2025
    '22/10/2025',
    '22/10/2025',
    '23/10/2025',
    '23/10/2025',
  ];
  assert.deepEqual(
    result1.items.map((it) => it.date),
    expectedDates1,
    'Danh sách ngày DD/MM/YYYY của Bộ mẫu 1 phải khớp chính xác'
  );

  // Kiểm tra thêm qua file .xlsx nhị phân thực tế (khi Excel lưu 9.2025 / 10.2025 dưới dạng number/string)
  const ws1 = XLSX.utils.aoa_to_sheet(sampleDataset1Rows);
  const xlsxWb1 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(xlsxWb1, ws1, 'Sheet1');
  const xlsxBuf1 = XLSX.write(xlsxWb1, { type: 'array', bookType: 'xlsx' });
  const file1 = new File([xlsxBuf1], 'dataset1.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const xlsxRes1 = await parseExcelWorkbook(file1, 'thousand', 2024);
  assert.deepEqual(
    xlsxRes1.items.map((it) => it.date),
    expectedDates1,
    'Parse từ file .xlsx thực tế cho Bộ mẫu 1 phải khớp hoàn toàn'
  );

  console.log('   -> PASS Test 2 (Bộ dữ liệu mẫu 1: "9.2025"/"10.2025" xen ngày lặp lại 22,22,23,23)!\n');

  // ---------------------------------------------------------------------------
  // Test 3 (Bộ dữ liệu mẫu 2):
  // Dùng mốc "t4/2026" theo sau bởi các ngày không tăng tuyệt đối:
  // (18, 18, 20, 21, 22, 25, 25, 26, 26)
  // ---------------------------------------------------------------------------
  console.log('3. Kiểm tra Bộ dữ liệu mẫu 2: Mốc "t4/2026" theo sau bởi (18,18,20,21,22,25,25,26,26)...');

  const sampleDataset2Rows: (string | number)[][] = [
    ['t4/2026', '', ''],
    [18, 150, 'Khoản chi ngày 18 (lần 1)'],
    [18, 200, 'Khoản chi ngày 18 (lần 2)'],
    [20, 120, 'Khoản chi ngày 20'],
    [21, 90, 'Khoản chi ngày 21'],
    [22, 300, 'Khoản chi ngày 22'],
    [25, 175, 'Khoản chi ngày 25 (lần 1)'],
    [25, 85, 'Khoản chi ngày 25 (lần 2)'],
    [26, 420, 'Khoản chi ngày 26 (lần 1)'],
    [26, 65, 'Khoản chi ngày 26 (lần 2)'],
  ];

  const wb2 = createRawWorkbookFromRows(sampleDataset2Rows, 'Dataset2_t4_2026.xlsx');
  const result2 = buildImportPreview(wb2, {
    startYear: 2025, // Cố tình truyền 2025 để kiểm tra "t4/2026" cập nhật năm thành 2026
    unitMode: 'thousand',
  });

  assert.equal(result2.items.length, 9, 'Bộ mẫu 2 phải parse ra đúng 9 khoản chi');
  assert.deepEqual(result2.monthsFound, ['Tháng 4/2026'], 'Bộ mẫu 2 phải nhận diện đúng Tháng 4/2026');
  assert.equal(
    result2.warningCount,
    0,
    'Các ngày không tăng tuyệt đối (18,18,20,21,22,25,25,26,26) hợp lệ nên warningCount phải bằng 0'
  );

  const expectedDates2 = [
    '18/04/2026',
    '18/04/2026',
    '20/04/2026',
    '21/04/2026',
    '22/04/2026',
    '25/04/2026',
    '25/04/2026',
    '26/04/2026',
    '26/04/2026',
  ];
  assert.deepEqual(
    result2.items.map((it) => it.date),
    expectedDates2,
    'Danh sách ngày DD/MM/YYYY của Bộ mẫu 2 phải khớp chính xác'
  );

  // Kiểm tra Bộ mẫu 2 khi một số ngày lặp lại được để trống ô ngày (forward-fill) và dán qua Clipboard TSV
  const sampleDataset2ClipboardTSV = [
    't4/2026\t\t',
    '18\t150\tKhoản chi ngày 18 (lần 1)',
    '\t200\tKhoản chi ngày 18 (lần 2 - ô ngày trống)',
    '20\t120\tKhoản chi ngày 20',
    '21\t90\tKhoản chi ngày 21',
    '22\t300\tKhoản chi ngày 22',
    '25\t175\tKhoản chi ngày 25 (lần 1)',
    '\t85\tKhoản chi ngày 25 (lần 2 - ô ngày trống)',
    '26\t420\tKhoản chi ngày 26 (lần 1)',
    '\t65\tKhoản chi ngày 26 (lần 2 - ô ngày trống)',
  ].join('\n');

  const clipWb2 = parseClipboardToRawWorkbook(sampleDataset2ClipboardTSV);
  assert.ok(clipWb2, 'parseClipboardToRawWorkbook phải nhận diện được bảng TSV của Bộ mẫu 2');
  const clipRes2 = buildImportPreview(clipWb2!, {
    startYear: 2025,
    unitMode: 'thousand',
  });
  assert.deepEqual(
    clipRes2.items.map((it) => it.date),
    expectedDates2,
    'Bộ mẫu 2 khi dùng forward-fill cho ô ngày trống phải ra đúng danh sách ngày'
  );

  console.log('   -> PASS Test 3 (Bộ dữ liệu mẫu 2: "t4/2026" với ngày 18,18,20,21,22,25,25,26,26)!\n');

  // ---------------------------------------------------------------------------
  // Test 4: Kiểm tra giữ nguyên năm ở mốc liền trước khi mốc mới không ghi năm
  // và cảnh báo khi ngày giảm mà không có mốc tháng xen giữa (Rule 1 & Rule 4)
  // ---------------------------------------------------------------------------
  console.log('4. Kiểm tra giữ nguyên năm khi mốc không ghi năm & cảnh báo ngày giảm không có mốc tháng...');

  const rule1And4Rows: (string | number)[][] = [
    ['t12/2025', '', ''],
    [25, 100, 'Chi tiêu cuối tháng 12'],
    ['t1', '', ''], // Không ghi năm -> phải giữ nguyên năm 2025 của dòng mốc liền trước ("t12/2025")
    [15, 200, 'Chi tiêu ngày 15'],
    [28, 300, 'Chi tiêu ngày 28'],
    [3, 150, 'Ngày 3 sau ngày 28 mà không có mốc tháng xen giữa'],
  ];

  const wb3 = createRawWorkbookFromRows(rule1And4Rows, 'Rule1And4.xlsx');
  const result3 = buildImportPreview(wb3, {
    startYear: 2026,
    unitMode: 'thousand',
  });

  assert.equal(result3.items.length, 4);
  assert.equal(result3.items[0].date, '25/12/2025');
  // Dòng sau mốc "t1" (không ghi năm) giữ nguyên năm 2025 từ mốc "t12/2025" liền trước
  assert.equal(result3.items[1].date, '15/01/2025');
  assert.equal(result3.items[2].date, '28/01/2025');
  // Dòng ngày 3 sau ngày 28 không có mốc tháng xen giữa: giữ nguyên tháng 1/2025 và đánh dấu cảnh báo day_decreased
  assert.equal(result3.items[3].date, '03/01/2025');
  assert.equal(result3.items[3].monthNum, 1);
  assert.equal(result3.items[3].year, 2025);
  assert.equal(
    result3.items[3].warningTypes.includes('day_decreased'),
    true,
    'Dòng có ngày 3 nhỏ hơn ngày 28 liền trước mà không có mốc tháng phải có cảnh báo day_decreased'
  );

  console.log('   -> PASS Test 4!\n');
  console.log('=== TẤT CẢ CÁC BÀI TEST PARSER ĐỀU PASS 100% ===');
}

runParserTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
