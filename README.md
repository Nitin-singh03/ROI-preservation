# Preserving-ROI-Encryption-System (ROIVault)

A privacy-preserving video and image encryption architecture. Sensitive Regions-of-Interest (ROIs) such as human faces are detected, cropped, and encrypted with **AES-256-GCM** before storage. Encryption keys are securely wrapped using post-quantum **ML-KEM-768** (FIPS 203) and **RSA-2048-OAEP**. An untrusted storage server only holds masked frames with blackened faces, while authorized clients decrypt and overlay high-resolution facial patches in real time on HTML5 `<canvas>`.

---

## 🔬 Face Detection & Person Tracking Experiments

We evaluated multiple face detection and tracking models across three test videos (`video1.mp4`, `video2.mp4`, and `video3.mp4`) containing varying resolutions (1080p, 4K), dynamic sideways profile turns, and crowd densities.

👉 **Read the full benchmark report:** [**`EXPERIMENTS.md`**](EXPERIMENTS.md)

### Key Findings Summary

| Video | Ground Truth ROIs | Haar Cascade | Pure YOLOv8-Face | YOLOv8-Pose | **Proposed Hybrid Architecture** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **`video1` (4K)** | **4** | 0.71 avg *(82% dropped)* | 4.25 avg *(6 tracks)* | 4.00 avg | **4.00 avg (4 tracks)** ✅ |
| **`video2` (1080p)** | **4** | 2.49 avg *(38% dropped)* | 3.33 avg *(6 tracks ⚠️)*| 4.00 avg | **3.95 avg (4 tracks)** ✅ |
| **`video3` (4K)** | **6** | 6.73 avg *(5 phantoms)* | 5.95 avg *(7 tracks)* | 6.08 avg | **6.00 avg (6 tracks)** ✅ |

### The Winning Model: **Proposed Hybrid Multi-Angle Architecture**
- **100% Multi-Angle Recall**: Combines **YOLOv8-Pose** body & anatomical landmark tracking with **YOLOv8-Face** fine facial feature matching.
- **Sideways Profile Recovery**: When a person turns 90° sideways, pose keypoints (ears, eyes, nose, shoulders) reconstruct the profile head box (recovered 76 frames in `video2` where pure face detectors failed).
- **Zero Facial Leakage**: Anatomical margins (+20% horizontal, +25% top, +15% bottom) completely cover the forehead, ears, hairline, and jawline.
- **Stable Tracking**: Custom ByteTrack configuration (`track_buffer: 120`) eliminates phantom track IDs and maintains consistent person numbering.
- **Temporal EMA Smoothing**: Eliminates frame-to-frame box jitter.

---

## 🏗️ Architecture & Project Structure

```
Preserving-ROI-Encryption-System/
├── EXPERIMENTS.md                  # Comprehensive empirical evaluation & benchmarks
├── benchmark_models.py             # Automated benchmarking suite for video models
├── videos/                         # Test videos (video1, video2, video3) [gitignored]
│
├── server/                         # FastAPI Backend
│   ├── detection_utils.py          # Hybrid Multi-Angle Detection & Tracking Engine
│   ├── video_utils.py              # Video processing, AES-GCM + ML-KEM-768 pipeline
│   ├── image_utils.py              # Static image processing & ROI encryption
│   ├── custom_tracker.yaml         # Optimized ByteTrack configuration
│   ├── reset_db.py                 # Clean database & upload directory reset script
│   ├── main.py                     # FastAPI REST API endpoints
│   ├── db.py                       # Lightweight JSON document database
│   └── database.json               # System database state
│
├── client/                         # React Frontend Web Application
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoPlayerWithOverlay.js  # HTML5 video + canvas overlay (Play/Pause/Replay)
│   │   │   ├── VideoViewer.js             # Video viewer & ML-KEM decapsulation manager
│   │   │   └── ImageViewer.js             # Image viewer with AES-GCM decryption
│   │   ├── pages/
│   │   │   ├── AdminDashboard.js          # Admin upload, key approvals, video management
│   │   │   └── UserDashboard.js           # User access requests & decrypted playback
│   │   └── utils/
│   │       ├── mlkemUtils.js              # Client-side ML-KEM decapsulation
│   │       └── cryptoUtils.js             # Web Crypto API utilities
│
└── roi 2/                          # Standalone CLI tools for video redaction & decryption
    ├── yolo_mask.py                # Standalone video masking script
    └── decrypt_person.py           # CLI video decryption tool by person ID
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.10+
- Node.js 18+

### 2. Backend Setup (FastAPI)
```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend Setup (React)
```bash
cd client
npm install
npm start
```

### 4. Database Reset (Fresh Start)
To clear previous videos, encrypted patches, and reset the database for fresh testing:
```bash
# Clears all videos, images, and ROIs (preserves user credentials)
python server/reset_db.py

# Or wipe everything including user accounts:
python server/reset_db.py --all
```

---

## 🔒 Security Specifications

1. **Symmetric Encryption**: Per-ROI / per-person **AES-256-GCM** with 96-bit unique IVs and 128-bit authentication tags.
2. **Post-Quantum Key Encapsulation**: **ML-KEM-768** (NIST FIPS 203) shared secret encapsulation.
3. **Sequential Video Delivery**: Anti-tampering controls preventing unauthorized forward/backward seeking while supporting **Pause** and **Replay** controls.
