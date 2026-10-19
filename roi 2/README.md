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
| `yolo_mask.py` | Production pipeline using YOLOv8 + ByteTrack. Outputs `masked_output.mp4`, `roi_metadata.json`, and `private_key.pem`. |
| `decrypt_person.py` | Decrypts and unmasks a specific person's face/ROI from `masked_output.mp4` by person track ID using `private_key.pem` and `roi_metadata.json`. |

## Setup

```bash
pip install -r requirements.txt
```

## Usage

**1. Demo (Haar Cascade):**
```bash
python main.py                        # expects video.mp4 in the same directory
python main.py --video path/to/video  # custom path
```

**2. Production Masking Pipeline (YOLO):**
```bash
# Place your video as input.mp4 (or video.mp4) in the project directory
python yolo_mask.py
# Outputs: masked_output.mp4, roi_metadata.json, private_key.pem
```

**3. Decrypt Specific Person ROI by ID:**
```bash
# Interactive mode (prompts for Person ID from available IDs)
python decrypt_person.py

# CLI mode specifying person ID directly
python decrypt_person.py --id 1

# Non-GUI mode (saves video without window preview)
python decrypt_person.py --id 1 --no-preview
```

> **Note:** Video files and model weights are excluded from this repo via `.gitignore`. Provide your own `input.mp4` / `video.mp4`.

## Security notes

- Unique AES-256 keys are generated per person ID and wrapped with an RSA-2048 public key
- In production, the RSA private key must be stored in a secure enclave or HSM
- `roi_metadata.json` contains encrypted ciphertext — only authorized holders of the private key can unwrap the identity-specific AES key

