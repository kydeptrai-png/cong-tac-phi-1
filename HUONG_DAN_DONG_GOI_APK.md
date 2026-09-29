# Hướng Dẫn Đóng Gói File APK Android Cho Ứng Dụng "Sổ Chi Tiêu & Công Tác Phí"

Dự án đã được tích hợp sẵn nền tảng **Capacitor Android** và đồng bộ toàn bộ tài nguyên web, giao diện tối ưu di động, quyền Camera/Bộ nhớ và biểu tượng ứng dụng.

---

## Cách 1: Đóng gói tự động trên GitHub Actions (Khuyên dùng - Không cần cài đặt gì trên máy tính)

File cấu hình CI/CD đã được tạo sẵn tại `.github/workflows/build-apk.yml`.
1. Đưa mã nguồn lên kho lưu trữ GitHub của bạn.
2. Vào tab **Actions** trên GitHub repository.
3. Chọn workflow **Build Android APK** và bấm **Run workflow**.
4. Chờ khoảng 2–3 phút, sau khi hoàn thành, bạn sẽ thấy mục **Artifacts** chứa file **`SoChiTieu-Android-Debug-APK`**. Tải về và giải nén là có ngay file `app-debug.apk` để cài đặt trực tiếp vào điện thoại Android.

---

## Cách 2: Sử dụng Android Studio (Trực tiếp trên máy tính)

Yêu cầu máy tính đã cài đặt [Android Studio](https://developer.android.com/studio).

1. **Build & Đồng bộ bản mới nhất (nếu có thay đổi mã nguồn):**
   ```bash
   npm run build
   npx cap sync android
   ```

2. **Mở dự án trong Android Studio:**
   ```bash
   npx cap open android
   ```
   *(Hoặc mở Android Studio -> Chọn "Open" -> Trỏ đến thư mục `android` trong dự án).*

3. **Xuất file APK:**
   - Trên thanh menu của Android Studio: Chọn **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
   - Khi hoàn tất, một thông báo sẽ xuất hiện ở góc dưới bên phải. Nhấn **locate** để mở thư mục chứa file:
     `android/app/build/outputs/apk/debug/app-debug.apk`
   - Chép file `app-debug.apk` này vào điện thoại và tiến hành cài đặt!

---

## Cách 3: Biên dịch nhanh bằng dòng lệnh (Terminal / Command Prompt)

Yêu cầu máy đã cài đặt Node.js 22+ và Java JDK 21+.

```bash
# 1. Build ứng dụng web và đồng bộ
npm run build
npx cap sync android

# 2. Vào thư mục android và build APK
cd android
./gradlew assembleDebug      # Trên macOS/Linux
# hoặc: gradlew.bat assembleDebug (Trên Windows)
```
File APK hoàn chỉnh sẽ nằm tại:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## Các tính năng đã được cấu hình sẵn trong gói Android:
- **Tên ứng dụng:** Sổ Chi Tiêu
- **Package ID:** `com.sochitieu.congtacphi`
- **Biểu tượng:** Đã tích hợp đầy đủ icon vào các thư mục `mipmap` (hdpi, mdpi, xhdpi, xxhdpi, xxxhdpi).
- **Quyền hạn (AndroidManifest.xml):**
  - Camera (`android.permission.CAMERA`): chụp hóa đơn chứng từ.
  - Bộ nhớ (`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`): lưu/tải file Excel, PDF, JSON.
  - Internet (`android.permission.INTERNET`): đồng bộ AI khi có mạng.
- **Hỗ trợ phím Back Android:** Nhấn nút Back trên điện thoại sẽ đóng cửa sổ/modal hiện tại thay vì thoát app.
- **Lưu trữ Offline bền vững:** Sử dụng IndexedDB nội bộ kết hợp `navigator.storage.persist()`.
