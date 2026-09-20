import os
import uuid
import cv2
import numpy as np
from Crypto.Cipher import AES, PKCS1_OAEP
from Crypto.PublicKey import RSA
from Crypto.Hash import SHA256

UPLOAD_BASE = os.path.join(os.path.dirname(__file__), "uploads")
BASE_DIR = os.path.join(UPLOAD_BASE, "base")
ROIS_DIR = os.path.join(UPLOAD_BASE, "rois")


def detect_rois(image_bytes: bytes) -> tuple[np.ndarray, list[dict]]:
    from ultralytics import YOLO

    model_path = os.path.join(os.path.dirname(__file__), "yolov8n-face.pt")
    model = YOLO(model_path)

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    h_img, w_img = img.shape[:2]
    results = model(img, conf=0.25, verbose=False)[0]

    rois = []
    for box in results.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        x = max(0, min(x1, w_img - 1))
        y = max(0, min(y1, h_img - 1))
        w = max(1, min(x2 - x1, w_img - x))
        h = max(1, min(y2 - y1, h_img - y))
        rois.append({"x": x, "y": y, "w": w, "h": h})

    return img, rois


def aes_encrypt(data: bytes) -> tuple[bytes, bytes, bytes, bytes]:
    key = os.urandom(32)
    cipher = AES.new(key, AES.MODE_GCM)
    ciphertext, tag = cipher.encrypt_and_digest(data)
    return key, cipher.nonce, tag, ciphertext


def rsa_encrypt_key(aes_key: bytes, public_key_b64: str) -> bytes:
    # Wrap raw Base64 SPKI into proper PEM with 64-char line wrapping
    wrapped = "\n".join(public_key_b64[i:i+64] for i in range(0, len(public_key_b64), 64))
    pem = f"-----BEGIN PUBLIC KEY-----\n{wrapped}\n-----END PUBLIC KEY-----"
    rsa_key = RSA.import_key(pem)
    cipher = PKCS1_OAEP.new(rsa_key, hashAlgo=SHA256)
    return cipher.encrypt(aes_key)


def process_image(image_bytes: bytes, admin_public_key: str) -> tuple[str, list[dict]]:
    img, roi_boxes = detect_rois(image_bytes)
    masked = img.copy()
    roi_records = []

    for box in roi_boxes:
        x, y, w, h = box["x"], box["y"], box["w"], box["h"]
        crop = img[y:y+h, x:x+w]
        _, crop_bytes = cv2.imencode(".png", crop)

        aes_key, nonce, tag, ciphertext = aes_encrypt(crop_bytes.tobytes())
        encrypted_aes_key = rsa_encrypt_key(aes_key, admin_public_key)

        roi_id = str(uuid.uuid4())
        roi_path = os.path.join(ROIS_DIR, f"{roi_id}.bin")
        with open(roi_path, "wb") as f:
            f.write(nonce + tag + ciphertext)

        cv2.rectangle(masked, (x, y), (x+w, y+h), (0, 0, 0), -1)

        roi_records.append({
            "roi_id": roi_id,
            "x": x, "y": y, "w": w, "h": h,
            "roi_path": roi_path,
            "encrypted_aes_key": encrypted_aes_key.hex()
        })

    image_id = str(uuid.uuid4())
    base_path = os.path.join(BASE_DIR, f"{image_id}.png")
    cv2.imwrite(base_path, masked)

    return image_id, base_path, roi_records
