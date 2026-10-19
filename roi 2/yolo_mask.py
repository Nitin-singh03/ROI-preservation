import cv2
import os
import json
import base64
import numpy as np
from ultralytics import YOLO
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization

# ==========================================
# 1. INITIALIZE CRYPTOGRAPHY (Admin Key Pair)
# ==========================================
pem_path = "private_key.pem"
if os.path.exists(pem_path):
    print("Loading existing administrator RSA key pair...")
    with open(pem_path, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)
else:
    print("Generating administrator RSA keys...")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with open(pem_path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ))
    print(f"Saved private key to: {pem_path}")

public_key = private_key.public_key()

# ==========================================
# 2. INITIALIZE DETECTION & TRACKING
# ==========================================
import sys
server_dir = os.path.join(os.path.dirname(__file__), "..", "server")
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)
from detection_utils import load_detection_models, extract_head_box, get_model_path

print("Loading multi-angle YOLO models (Pose + Face)...")
pose_model, face_model = load_detection_models()

tracker_cfg = get_model_path("custom_tracker.yaml")
if not os.path.exists(tracker_cfg):
    tracker_cfg = "bytetrack.yaml"

input_video = "input.mp4" if os.path.exists("input.mp4") else "video.mp4"
output_video = "masked_output.mp4"
keys_file = "roi_keys.json"
metadata_file = "roi_metadata.jsonl"

if not os.path.exists(input_video):
    print(f"Error: Could not find '{input_video}'. Please place a video file named 'input.mp4' or 'video.mp4' in this directory.")
    exit(1)

cap = cv2.VideoCapture(input_video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = int(cap.get(cv2.CAP_PROP_FPS))

fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

track_keys = {}          # Maps track_id -> unique AES key
track_wrapped_keys = {}  # Maps track_id -> RSA-wrapped AES key (one per unique person)
smoothed_boxes = {}      # Maps track_id -> (hx1, hy1, hx2, hy2)

frame_idx = 0
print(f"Processing video: {input_video} with multi-angle pose+face tracking...")

# Stream write frame metadata line-by-line to avoid keeping large payloads in RAM
with open(metadata_file, "w", encoding="utf-8") as meta_out:
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # 1. Track human bodies with ByteTrack (stable IDs across full video)
        pose_res = pose_model.track(
            frame,
            persist=True,
            tracker=tracker_cfg,
            conf=0.35,
            verbose=False
        )[0]

        # 2. Detect frontal faces for fine-tuned feature matching
        face_boxes = []
        if face_model is not None:
            fr = face_model(frame, conf=0.40, verbose=False)[0]
            if fr.boxes is not None and len(fr.boxes) > 0:
                face_boxes = fr.boxes.xyxy.cpu().numpy()

        masked_frame = frame.copy()

        if pose_res.boxes is not None and pose_res.boxes.id is not None:
            boxes = pose_res.boxes.xyxy.cpu().numpy()
            track_ids = pose_res.boxes.id.cpu().numpy()
            kpts_xy = pose_res.keypoints.xy.cpu().numpy()
            kpts_conf = pose_res.keypoints.conf.cpu().numpy()

            for box, track_id, kp, conf in zip(boxes, track_ids, kpts_xy, kpts_conf):
                t_id = int(track_id)

                # Extract head/face box (handles frontal, sideways profile, and turned positions)
                hx1, hy1, hx2, hy2, method = extract_head_box(
                    box, kp, conf, face_boxes, width, height
                )

                # Temporal EMA smoothing to eliminate micro-jittering across frames
                if t_id in smoothed_boxes:
                    prev = smoothed_boxes[t_id]
                    hx1 = int(0.75 * hx1 + 0.25 * prev[0])
                    hy1 = int(0.75 * hy1 + 0.25 * prev[1])
                    hx2 = int(0.75 * hx2 + 0.25 * prev[2])
                    hy2 = int(0.75 * hy2 + 0.25 * prev[3])
                smoothed_boxes[t_id] = (hx1, hy1, hx2, hy2)

                # Bound coordinates to frame dimensions
                hx1 = max(0, min(hx1, width - 1))
                hy1 = max(0, min(hy1, height - 1))
                hx2 = max(0, min(hx2, width))
                hy2 = max(0, min(hy2, height))
                w, h = hx2 - hx1, hy2 - hy1

                if w <= 0 or h <= 0:
                    continue

                    
                # --- UNIQUE KEY-PER-ROI (TRACK ID) LOGIC ---
                if t_id not in track_keys:
                    k = AESGCM.generate_key(bit_length=256)
                    track_keys[t_id] = k
                    
                    wrapped = public_key.encrypt(
                        k,
                        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
                    )
                    track_wrapped_keys[t_id] = base64.b64encode(wrapped).decode('utf-8')

                # --- EXTRACT & MASK (Head/Face region) ---
                face_patch = frame[hy1:hy2, hx1:hx2]
                masked_frame[hy1:hy2, hx1:hx2] = (0, 0, 0)
                
                # --- ENCRYPT ---
                aesgcm = AESGCM(track_keys[t_id])
                patch_bytes = face_patch.tobytes()
                iv = os.urandom(12)
                
                encrypted_payload = aesgcm.encrypt(iv, patch_bytes, None)
                ciphertext = encrypted_payload[:-16]
                tag = encrypted_payload[-16:]
                
                # --- STREAM STORE METADATA ---
                record = {
                    "frame_index": frame_idx,
                    "track_id": t_id,
                    "bbox": [hx1, hy1, w, h],
                    "iv": base64.b64encode(iv).decode('utf-8'),
                    "ciphertext": base64.b64encode(ciphertext).decode('utf-8'),
                    "tag": base64.b64encode(tag).decode('utf-8')
                }
                meta_out.write(json.dumps(record) + "\n")
                
        out.write(masked_frame)
        frame_idx += 1

cap.release()
out.release()

# --- SAVE KEYS TO DISK ---
with open(keys_file, "w", encoding="utf-8") as f:
    json.dump({"wrapped_keys": track_wrapped_keys}, f, indent=2)

print("\nProcessing complete!")
print(f" - Masked video saved to: {output_video}")
print(f" - ROI Metadata saved to: {metadata_file} (streamed JSONL)")
print(f" - Wrapped Keys saved to: {keys_file}")
print(f" - RSA Private Key saved to: {pem_path}")


