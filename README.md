# 🎙️ Realistic Roleplay Voice Server & Web Client

**WebRTC P2P Proximity Voice Chat System with 3D Spatial Audio & Wall Occlusion for Minecraft Bedrock Edition**  
*100% Zero-Cost Architecture (Node.js Signaling + Google Free STUN + Web Audio API)*

🌐 **Live Production:** [https://mcpe-webrtc-p2p-web-audio-api.onrender.com/](https://mcpe-webrtc-p2p-web-audio-api.onrender.com/)

---

## 🌟 ฟีเจอร์หลัก (Key Features)

| ฟีเจอร์ | รายละเอียดทางเทคนิค |
|---|---|
| **มิติเสียง 3D (Spatial HRTF)** | จำลองตำแหน่งเสียงรอบทิศทาง 360 องศา ซ้าย-ขวา-หน้า-หลัง ด้วย Web Audio API `PannerNode` (HRTF) ตามพิกัดและทิศทางการหันหน้าจริงของผู้เล่นในเกม |
| **การตัดเสียงระยะไกลเด็ดขาด (Strict Distance Cutoff)** | คำนวณระยะห่าง 3D Euclidean และผ่อนเสียงลงด้วยสมการ Cosine Curve สมจริง เมื่อผู้เล่นอยู่เกินระยะไมค์ (`distance >= maxDistance`) หรืออยู่คนละมิติ (Overworld/Nether) เสียงจะถูกตัดเป็น **0.0 (เงียบสนิท 100%)** |
| **สิ่งกีดขวาง & กำแพงกั้นเสียง (Wall Occlusion)** | กรองความถี่เสียงผ่าน Biquad Low-pass Filter ทำให้เสียงพูดทุ้มอู้อี้อย่างสมจริงเมื่อมีบล็อกทึบหรือกำแพงกั้นระหว่างผู้เล่น |
| **ชิปเลือกชื่ออัจฉริยะ (Quick Select Chips)** | เชื่อมต่ออัตโนมัติ 1:1 กับ Gamertag ในเกม มีปุ่มชิปชื่อตัวละครสีเขียวให้แตะเลือกได้ทันที ป้องกันปัญหาพิมพ์ผิด |
| **โหมดหน้าต่างลอยบนจอมือถือ (Picture-in-Picture HUD)** | แปลงหน้าจอไมค์เป็นหน้าต่างลอยขนาดเล็กบนจอมือถือ แสดงสถานะไมค์สด และช่วยให้เบราว์เซอร์ **ไม่หลับ ไม่โดนระบบมือถือตัดสิทธิ์ไมโครโฟน** ขณะสลับไปเล่นมายคราฟ |
| **Background Web Worker Keep-Alive** | เธรดเบื้องหลังส่งสัญญาณ Heartbeat ทุก 2 วินาที ป้องกัน Android / iOS แช่แข็งการเชื่อมต่อเมื่อสลับแท็บ |
| **ระบบเคลียร์เซสชันผี (Ghost Peer Auto-Pruning)** | ป้องกันรายชื่อซ้ำซ้อน (`Player_100x`) เซิร์ฟเวอร์จะปิดและเคลียร์การเชื่อมต่อเก่าของชื่อเดียวกันทันทีที่มีการเชื่อมต่อใหม่ |

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```
2. แฟ้มติดตั้งบน Web Hosting (Voice Server)/
├── server/
│   └── server.js               # Node.js HTTP/WebSocket Server + Telemetry Relay
├── web_client/
│   ├── index.html              # Modern Obsidian & Titanium MetalForge UI
│   ├── css/
│   │   └── style.css           # Responsive Dark Mode & Cyberpunk UI Styling
│   └── js/
│       ├── app.js              # UI Controller, Hotkeys, PiP Controller & Web Worker
│       ├── audio_engine.js     # Web Audio API 3D Pipeline & Distance Attenuation
│       ├── occlusion_filter.js # Biquad Low-pass Filter ทะลุกำแพง
│       ├── radio_effects.js    # Bandpass Filter สำหรับวิทยุสื่อสาร
│       └── webrtc_manager.js   # WebRTC PeerConnection & P2P Stream Signaling
├── package.json
└── README.md
```

---

## 🚀 วิธีติดตั้งและรันเซิร์ฟเวอร์ (Quickstart)

### 1. รันบนเครื่องตนเอง (Localhost)
```bash
# ติดตั้ง dependencies
npm install

# รันเซิร์ฟเวอร์
npm start
```
เปิดเบราว์เซอร์เข้าไปที่: `http://localhost:3000`

---

### 2. การโฮสต์บน Cloud Hosting ฟรี (Render.com)
1. Fork หรือ Push โฟลเดอร์นี้ขึ้น GitHub Repository
2. เข้าสู่ระบบ [Render.com](https://render.com/) และสร้าง **New Web Service**
3. กำหนดค่า:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server/server.js`
   - **Instance Type:** `Free`
4. คุณจะได้รับ URL แบบ HTTPS/WSS เช่น `https://your-service.onrender.com` ใช้งานได้ตลอด 24 ชั่วโมงฟรี

---

## 📱 คู่มือการใช้งานสำหรับผู้เล่นบนมือถือ (Android / iOS)

เนื่องจากระบบความปลอดภัยของมือถือจะตัดไมโครโฟนเมื่อแท็บเบราว์เซอร์ถูกซ่อน ให้เลือกใช้ 1 ใน 2 วิธีนี้:

### วิธีที่ 1: ใช้ปุ่มหน้าต่างลอย (Picture-in-Picture)
1. เปิดหน้าเว็บ voice เลือกชื่อตัวละคร และกด **"เปิดไมค์ (Connect)"**
2. กดปุ่ม **`📺 ลอยหน้าต่าง (PiP)`** หน้าต่างมินิไมค์จะลอยอยู่บนหน้าจอ
3. สลับแอพไปเข้าเล่นเกมมายคราฟได้ทันที ไมค์จะไม่โดนตัดตลอดการเล่น

### วิธีที่ 2: ใช้โหมดหน้าต่างป๊อปอัพ (Pop-up View / Split Screen)
1. เปิดหน้าเว็บ voice และเชื่อมต่อไมค์
2. กดปุ่มสลับแอพของมือถือ (Recent Apps) ➔ แตะไอคอน Chrome ค้างไว้
3. เลือก **"เปิดในมุมมองป๊อปอัพ (Pop-up view)"** หรือ **"แบ่งหน้าจอ (Split Screen)"**
4. ย่อขนาดหน้าต่างเว็บไว้มุมจอ แล้วเข้าเล่นเกมตามปกติ

---

## 🔌 API Endpoints Reference

- **`GET /api/status`** : ตรวจสอบสถานะการทำงานของเซิร์ฟเวอร์, Uptime และจำนวนผู้เชื่อมต่อ
- **`GET /api/players`** : ดึงรายชื่อผู้เล่นที่กำลังออนไลน์ใน Minecraft Bedrock สำหรับสร้าง Dropdown / ชิปเลือกชื่อ
- **`POST /api/telemetry`** : จุดรับข้อมูลพิกัด (X, Y, Z), ทิศทางการหัน, มิติ, โหมดระยะไมค์ และค่า Occlusion จาก Addon ในเกม

---

## 🛡️ สถาปัตยกรรมความปลอดภัยและเสถียรภาพ
- **WebRTC P2P Direct Stream:** เสียงพูดสตรีมระหว่างผู้เล่นโดยตรงผ่าน P2P ไม่ผ่านการบันทึกหรือดักฟังบนเซิร์ฟเวอร์
- **Dummy Muted Element Decoupling:** แยกแท็กเสียงดัมมี่เพื่อความเข้ากันได้กับ iOS WebRTC โดยไม่ให้เสียงดิบเล็ดลอดข้ามระยะทาง
- **STUN Redundancy:** ใช้ `stun:stun.l.google.com:19302` ฟรีและเสถียรระดับสากล

---
**พัฒนาและปรับแต่งโดย:** ZirconX
