# ✨ AuraErase Studio — Xóa Logo Gemini, Nano Banana, Omni & Veo 3

Ứng dụng web xử lý ảnh & video **100% chạy cục bộ trên trình duyệt (client-side)** giúp xóa watermark nhìn thấy của **Google Gemini, Nano Banana, Gemini Omni, Google Flow & Veo 3** bằng phương pháp toán học **Reverse Alpha Blending** chuẩn từng pixel — không làm mờ ảnh, không gửi dữ liệu lên server, không quảng cáo.

## 🚀 Tính năng nổi bật

- **Exact Reverse Alpha Blending**: Sử dụng bản đồ alpha gốc (`bg_48` & `bg_96`) khôi phục 100% pixel gốc:
  $$\text{Original} = \frac{\text{Watermarked} - (\alpha \times 255)}{1 - \alpha}$$
- **Tự động nhận diện đa tỉ lệ (Auto-Detect 1px)**: Kết hợp White/Dark Polarity NCC + Gradient Edge NCC và tinh chỉnh 1px + **Auto Gain**.
- **Live Tuner 60fps + 2 ô Zoom cận cảnh**: Xem trực tiếp **Gốc vs Đã xóa** theo từng pixel khi kéo thanh trượt (`Gain`, `Scale`, `Offset X`, `Offset Y`) hoặc kéo khung trực tiếp trên ảnh.
- **Xử lý Video MP4 H.264 + Giữ 100% Âm Thanh Gốc (`#video`)**: Dùng **WebCodecs + MediaBunny** để giải mã, khử watermark từng khung hình và xuất MP4 H.264 với Audio Passthrough.
- **Xóa hàng loạt & Xuất ZIP Lossless**: Hỗ trợ dán ảnh (`Ctrl+V`), kéo thả nhiều ảnh và tải về file `.zip`.
- **Tẩy Tự Do (Magic Brush)**: Tô trực tiếp lên logo/watermark bất kỳ để tái tạo vân nền tự nhiên.

## 💻 Cài đặt & Chạy cục bộ

```bash
npm install
npm run dev
```

Build bản production:

```bash
npm run build
npm run preview
```

## 🛠️ Công nghệ sử dụng

- React 19 + TypeScript + Vite 8
- HTML5 Canvas API & WebCodecs API
- [MediaBunny](https://github.com/diffusion-studio/mediabunny) (H.264 MP4 muxing & audio passthrough)
- JSZip + Lucide React

## 📄 Ghi nhận & Bản quyền

- Thuật toán Reverse Alpha Blending và bản đồ alpha chuẩn (`bg_48`, `bg_96`) tham khảo từ dự án mã nguồn mở MIT [ishara-madu/gemini-watermark-remover](https://github.com/ishara-madu/gemini-watermark-remover).
- Phân phối theo giấy phép **MIT License**.
