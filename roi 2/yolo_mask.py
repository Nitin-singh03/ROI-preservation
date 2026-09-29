import cv2
import os
import json
import base64
import numpy as np
from ultralytics import YOLO
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes

# ==========================================
# 1. INITIALIZE CRYPTOGRAPHY (Admin Key Pair)
# ==========================================
print("Generating administrator RSA keys...")
private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
public_key = private_key.public_key()

# ==========================================
# 2. INITIALIZE DETECTION & TRACKING
# ==========================================
print("Loading YOLO model...")
# Using the standard yolov8n.pt which downloads safely and reliably. 
# We filter for class 0 (person) to track people and target the head/face region.
model = YOLO("yolov8n.pt") 

input_video = "input.mp4" if os.path.exists("input.mp4") else "video.mp4"
output_video = "masked_output.mp4"
metadata_file = "roi_metadata.json"

if not os.path.exists(input_video):
    print(f"Error: Could not find '{input_video}'. Please place a video file named 'input.mp4' in this directory.")
    exit(1)

cap = cv2.VideoCapture(input_video)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = int(cap.get(cv2.CAP_PROP_FPS))

fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(output_video, fourcc, fps, (width, height))

track_keys = {}          # Maps track_id -> unique AES key
track_wrapped_keys = {}  # Maps track_id -> RSA-wrapped AES key (one per unique person)
roi_frames = []          # Compact frame logs

frame_idx = 0
print(f"Processing video: {input_video}...")

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
        
    # Run tracking using ByteTrack, filtering for persons (classes=[0])
    results = model.track(frame, persist=True, tracker="bytetrack.yaml", classes=[0], verbose=False)
    
    masked_frame = frame.copy()
    
    if results[0].boxes is not None and results[0].boxes.id is not None:
        boxes = results[0].boxes.xyxy.cpu().numpy()
        track_ids = results[0].boxes.id.cpu().numpy()
        
        for box, track_id in zip(boxes, track_ids):
            t_id = int(track_id)
            x1, y1, x2, y2 = map(int, box)
            
            # Heuristic: Focus the redaction box on the upper portion (the head/face area) of the detected person
            person_height = y2 - y1
            face_height = int(person_height * 0.35) # Top 35% covers the head/face
            
            hx1, hy1, hx2, hy2 = x1, y1, x2, y1 + face_height
            
            # Bound coordinates to frame dimensions
            hx1, hy1 = max(0, hx1), max(0, hy1)
            hx2, hy2 = min(width, hx2), min(height, hy2)
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
            
            # --- STORE METADATA ---
            roi_frames.append({
                "frame_index": frame_idx,
                "track_id": t_id,
                "bbox": [hx1, hy1, w, h],
                "iv": base64.b64encode(iv).decode('utf-8'),
                "ciphertext": base64.b64encode(ciphertext).decode('utf-8'),
                "tag": base64.b64encode(tag).decode('utf-8')
            })
            
    out.write(masked_frame)
    frame_idx += 1

cap.release()
out.release()
