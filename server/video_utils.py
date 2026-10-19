"""
video_utils.py
Server-side video processing pipeline for ROIVault.
- Receives a raw video (MP4 bytes)
- Runs YOLOv8 person tracking (ByteTrack)
- Per unique track_id: generates AES-256 key, encapsulates it with admin's ML-KEM-768 public key
- Per frame ROI (face/head patch): AES-GCM encrypts the patch, streams metadata to JSONL file
- Saves masked video (faces blacked out)
- Returns (video_id, masked_video_path, roi_keys_path, metadata_path, persons_list)
"""

import os
import uuid
import json
import base64
import tempfile
import numpy as np
from typing import Tuple, List, Dict

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Optional: ML-KEM via the `mlkem` Python package or fallback to oqs (liboqs)
# We try `mlkem` first, then `oqs`, then plain RSA-OAEP as a graceful fallback.
def _load_kem():
    # Try mlkem Python package (pip install mlkem)
    try:
        import mlkem
        return "mlkem", mlkem
    except ImportError:
        venv_site = os.path.join(os.path.dirname(__file__), "venv", "Lib", "site-packages")
        if os.path.exists(venv_site):
            import sys
            if venv_site not in sys.path:
                sys.path.insert(0, venv_site)
            try:
                import mlkem
                return "mlkem", mlkem
            except ImportError:
                pass

    # Try liboqs-python (pip install pyoqs)
    try:
        import oqs
        return "oqs", oqs
    except ImportError:
        pass
    return "rsa_fallback", None



KEM_BACKEND, _kem_mod = _load_kem()
print(f"[video_utils] KEM backend: {KEM_BACKEND}")


def mlkem_encapsulate(admin_mlkem_public_key_b64: str) -> Tuple[bytes, str]:
    """
    Encapsulate a shared secret using the admin's ML-KEM-768 public key.
    Returns (shared_secret_bytes, ciphertext_b64)
    The shared_secret is used as the AES-256 key (32 bytes).
    """
    public_key = base64.b64decode(admin_mlkem_public_key_b64)

    if KEM_BACKEND == "mlkem":
        import mlkem
        ek = mlkem.EncapsKey.from_bytes(public_key)
        kem = mlkem.ML_KEM(mlkem.ParameterSet.ML_KEM_768)
        shared_secret, ciphertext = kem.encaps(ek)
        return bytes(shared_secret[:32]), base64.b64encode(bytes(ciphertext)).decode()

    elif KEM_BACKEND == "oqs":
        import oqs
        with oqs.KeyEncapsulation("Kyber768") as client:
            ciphertext, shared_secret = client.encap_secret(public_key)
        return bytes(shared_secret[:32]), base64.b64encode(ciphertext).decode()

    else:
        # RSA-OAEP fallback: treat public_key_b64 as RSA SPKI
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives import hashes, serialization
        rsa_pub = serialization.load_der_public_key(public_key)
        aes_key = AESGCM.generate_key(bit_length=256)
        ciphertext = rsa_pub.encrypt(
            aes_key,
            padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
        )
        return aes_key, base64.b64encode(ciphertext).decode()


def process_video(
    video_bytes: bytes,
    admin_mlkem_public_key_b64: str,
    uploads_dir: str
) -> Dict:
    """
    Main video processing pipeline.

    Args:
        video_bytes: Raw bytes of the input video file.
        admin_mlkem_public_key_b64: Base64-encoded ML-KEM-768 public key of the admin.
        uploads_dir: Directory to store output files.

    Returns:
        dict with keys:
            video_id, masked_video_path, roi_keys_path, metadata_path,
            persons (list of person dicts with track_id, frame_count)
    """
    import cv2
    from ultralytics import YOLO

    video_id = str(uuid.uuid4())
    video_dir = os.path.join(uploads_dir, "videos", video_id)
    os.makedirs(video_dir, exist_ok=True)

    # Write input video to a temp file
    input_path = os.path.join(video_dir, "input.mp4")
    with open(input_path, "wb") as f:
        f.write(video_bytes)

    masked_path = os.path.join(video_dir, "masked.mp4")
    metadata_path = os.path.join(video_dir, "roi_metadata.jsonl")
    roi_keys_path = os.path.join(video_dir, "roi_keys.json")

    # Load detection models (YOLOv8-Pose for reliable multi-angle tracking & YOLOv8-Face for frontal features)
    from detection_utils import load_detection_models, extract_head_box, get_model_path
    pose_model, face_model = load_detection_models()

    tracker_cfg = get_model_path("custom_tracker.yaml")
    if not os.path.exists(tracker_cfg):
        tracker_cfg = "bytetrack.yaml"

    cap = cv2.VideoCapture(input_path)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 25
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Try H.264 (avc1) first for native browser HTML5 <video> compatibility
    fourcc = cv2.VideoWriter_fourcc(*"avc1")
    out = cv2.VideoWriter(masked_path, fourcc, fps, (width, height))
    if not out.isOpened():
        fourcc = cv2.VideoWriter_fourcc(*"H264")
        out = cv2.VideoWriter(masked_path, fourcc, fps, (width, height))
    if not out.isOpened():
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(masked_path, fourcc, fps, (width, height))

    # Per track: AES key bytes & ML-KEM ciphertext (b64)
    track_aes_keys: Dict[int, bytes] = {}
    track_kem_ciphertexts: Dict[int, str] = {}
    track_frame_counts: Dict[int, int] = {}
    smoothed_boxes: Dict[int, Tuple[int, int, int, int]] = {}

    frame_idx = 0
    print(f"[video_utils] Processing video {video_id}, {total_frames} frames at {fps} fps with multi-angle pose+face tracking...")

    with open(metadata_path, "w", encoding="utf-8") as meta_out:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # 1. Track human bodies with ByteTrack (prevents track ID flickering/duplication)
            pose_results = pose_model.track(
                frame,
                persist=True,
                tracker=tracker_cfg,
                conf=0.35,
                verbose=False
            )[0]

            # 2. Detect frontal faces for fine-tuned feature matching
            face_boxes = []
            if face_model is not None:
                face_res = face_model(frame, conf=0.40, verbose=False)[0]
                if face_res.boxes is not None and len(face_res.boxes) > 0:
                    face_boxes = face_res.boxes.xyxy.cpu().numpy()

            masked_frame = frame.copy()

            if pose_results.boxes is not None and pose_results.boxes.id is not None:
                boxes = pose_results.boxes.xyxy.cpu().numpy()
                track_ids = pose_results.boxes.id.cpu().numpy()
                kpts_xy = pose_results.keypoints.xy.cpu().numpy()
                kpts_conf = pose_results.keypoints.conf.cpu().numpy()

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

                    hx1 = max(0, min(hx1, width - 1))
                    hy1 = max(0, min(hy1, height - 1))
                    hx2 = max(0, min(hx2, width))
                    hy2 = max(0, min(hy2, height))
                    w, h = hx2 - hx1, hy2 - hy1
                    if w <= 0 or h <= 0:
                        continue

                    # Generate AES key + ML-KEM encapsulation on first encounter
                    if t_id not in track_aes_keys:
                        aes_key, kem_ct_b64 = mlkem_encapsulate(admin_mlkem_public_key_b64)
                        track_aes_keys[t_id] = aes_key
                        track_kem_ciphertexts[t_id] = kem_ct_b64
                        track_frame_counts[t_id] = 0

                    # Black out face in masked frame
                    face_patch = frame[hy1:hy2, hx1:hx2].copy()
                    masked_frame[hy1:hy2, hx1:hx2] = (0, 0, 0)

                    # Encrypt face patch with AES-GCM
                    aesgcm = AESGCM(track_aes_keys[t_id])
                    iv = os.urandom(12)
                    patch_bytes = face_patch.tobytes()
                    encrypted_payload = aesgcm.encrypt(iv, patch_bytes, None)
                    ciphertext_bytes = encrypted_payload[:-16]
                    tag_bytes = encrypted_payload[-16:]

                    # Stream write ROI metadata
                    record = {
                        "frame_index": frame_idx,
                        "track_id": t_id,
                        "bbox": [hx1, hy1, w, h],
                        "patch_shape": [h, w, 3],
                        "iv": base64.b64encode(iv).decode(),
                        "ciphertext": base64.b64encode(ciphertext_bytes).decode(),
                        "tag": base64.b64encode(tag_bytes).decode(),
                    }
                    meta_out.write(json.dumps(record) + "\n")
                    track_frame_counts[t_id] = track_frame_counts.get(t_id, 0) + 1

            out.write(masked_frame)
            frame_idx += 1

    cap.release()
    out.release()

    # Apply faststart: relocate the moov atom to the front of the file so browsers stream instantly
    try:
        from qtfaststart import processor
        fast_path = os.path.join(video_dir, "masked_fast.mp4")
        processor.process(masked_path, fast_path)
        if os.path.exists(fast_path) and os.path.getsize(fast_path) > 0:
            os.replace(fast_path, masked_path)
            print(f"[video_utils] Applied faststart optimization to {masked_path}")
    except Exception as e:
        print(f"[video_utils] Faststart note: {e}")

    # Save ML-KEM ciphertexts (one per person)
    roi_keys_data = {
        "kem_backend": KEM_BACKEND,
        "kem_ciphertexts": {
            str(t_id): ct_b64
            for t_id, ct_b64 in track_kem_ciphertexts.items()
        }
    }
    with open(roi_keys_path, "w", encoding="utf-8") as f:
        json.dump(roi_keys_data, f, indent=2)

    # Filter out transient phantom tracks (< 5 frames) to present a clean, verified list of persons
    valid_tids = [t_id for t_id in track_aes_keys.keys() if track_frame_counts.get(t_id, 0) >= 5]
    if not valid_tids:
        valid_tids = list(track_aes_keys.keys())

    persons = [
        {
            "track_id": t_id,
            "frame_count": track_frame_counts.get(t_id, 0),
            "kem_ciphertext_b64": track_kem_ciphertexts[t_id],
        }
        for t_id in sorted(valid_tids)
    ]

    print(f"[video_utils] Done. {frame_idx} frames, {len(persons)} persons tracked.")

    return {
        "video_id": video_id,
        "masked_video_path": masked_path,
        "roi_keys_path": roi_keys_path,
        "metadata_path": metadata_path,
        "fps": fps,
        "width": width,
        "height": height,
        "total_frames": frame_idx,
        "persons": persons,
    }
