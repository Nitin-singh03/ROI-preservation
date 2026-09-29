# ROIVault

A proof-of-concept for **zero-knowledge video redaction** — sensitive regions (faces/people) are encrypted before leaving the source, so an untrusted server only ever stores masked frames. Authorized clients decrypt and restore the original pixels locally.

## How it works

1. Detect faces or people in each video frame
2. Extract the ROI pixel patch and black it out in the stored frame
3. Encrypt the patch with AES-256-GCM (unique key per tracked identity)
4. The AES key is wrapped with RSA-OAEP so only the key-holder can decrypt
5. An authorized client decrypts and overlays the patch at render time

## Scripts

| Script | Description |
|---|---|
| `main.py` | Quick demo using OpenCV Haar Cascade. Side-by-side preview of masked vs. decrypted view. |
| `yolo_mask.py` | Production pipeline using YOLOv8 + ByteTrack. Outputs a masked video and `roi_metadata.json` with encrypted payloads. |

## Setup

```bash
pip install -r requirements.txt
```

## Usage

**Demo (Haar Cascade):**
```bash
python main.py                        # expects video.mp4 in the same directory
python main.py --video path/to/video  # custom path
```

**Production pipeline (YOLO):**
```bash
# Place your video as input.mp4 (or video.mp4) in the project directory
python yolo_mask.py
# Outputs: masked_output.mp4, roi_metadata.json
```

> **Note:** Video files and model weights are excluded from this repo via `.gitignore`. Provide your own `input.mp4` / `video.mp4`.

## Security notes

- AES keys are generated fresh each session and never written to disk in these demos
- In production, the RSA private key must be stored in a secure enclave or HSM
- `roi_metadata.json` contains encrypted ciphertext — treat it as sensitive
