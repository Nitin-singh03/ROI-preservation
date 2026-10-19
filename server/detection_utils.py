import os
import cv2
import numpy as np
from ultralytics import YOLO

# Cache loaded models so they are not re-instantiated on every request
_POSE_MODEL = None
_FACE_MODEL = None


def get_model_path(filename: str) -> str:
    """Find model weights across server, root, and roi 2 directories."""
    candidates = [
        os.path.join(os.path.dirname(__file__), filename),
        os.path.join(os.path.dirname(__file__), "..", filename),
        os.path.join(os.path.dirname(__file__), "..", "roi 2", filename),
        os.path.join(os.path.dirname(__file__), "weights", filename),
    ]
    for p in candidates:
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            return os.path.abspath(p)
    return filename


def load_detection_models():
    """Load both YOLOv8-Pose (for stable person tracking & profile/sideways head detection)
    and YOLOv8-Face (for frontal face fine-tuning)."""
    global _POSE_MODEL, _FACE_MODEL

    if _POSE_MODEL is None:
        pose_path = get_model_path("yolov8n-pose.pt")
        _POSE_MODEL = YOLO(pose_path)

    if _FACE_MODEL is None:
        face_path = get_model_path("yolov8n-face.pt")
        if os.path.exists(face_path):
            _FACE_MODEL = YOLO(face_path)
        else:
            _FACE_MODEL = None

    return _POSE_MODEL, _FACE_MODEL


def extract_head_box(person_box, kp_xy, kp_conf, face_boxes, img_w: int, img_h: int):
    """
    Extracts an accurate, complete head/face bounding box for a detected person.
    Handles:
      1. Frontal faces: matches YOLOv8-face detection and applies comfortable margins
         (covering forehead, hair, ears, and chin).
      2. Sideways / profile faces: uses pose keypoints (ears, eyes, nose) + shoulders
         when frontal face detector fails.
      3. Turned away / back of head: uses shoulder baseline and upper person geometry.

    Returns:
      (hx1, hy1, hx2, hy2, method)
    """
    px1, py1, px2, py2 = person_box
    pw = max(1, px2 - px1)
    ph = max(1, py2 - py1)

    # In human anatomy, head & face reside in the upper ~45% of the person's bounding box
    head_zone = [px1, py1, px2, py1 + ph * 0.45]

    # --- 1. Match with frontal face detector boxes inside head zone ---
    matched_face = None
    best_iou = 0
    if face_boxes is not None and len(face_boxes) > 0:
        for fb in face_boxes:
            fx1, fy1, fx2, fy2 = fb[:4]
            ix1, iy1 = max(fx1, head_zone[0]), max(fy1, head_zone[1])
            ix2, iy2 = min(fx2, head_zone[2]), min(fy2, head_zone[3])
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                area = max(1, (fx2 - fx1) * (fy2 - fy1))
                iou = inter / area
                if iou > best_iou:
                    best_iou = iou
                    matched_face = fb[:4]

    if matched_face is not None:
        fx1, fy1, fx2, fy2 = matched_face
        fw, fh = fx2 - fx1, fy2 - fy1
        # Add comfortable margins:
        # +20% horizontal margin on each side (covers ears and temples)
        # +25% top margin (covers forehead and hairline)
        # +15% bottom margin (covers chin and jawline)
        hx1 = max(0, int(fx1 - 0.20 * fw))
        hx2 = min(img_w, int(fx2 + 0.20 * fw))
        hy1 = max(0, int(fy1 - 0.25 * fh))
        hy2 = min(img_h, int(fy2 + 0.15 * fh))
        if hx2 > hx1 and hy2 > hy1:
            return hx1, hy1, hx2, hy2, "face"

    # --- 2. Sideways / Profile fallback using pose keypoints ---
    # Keypoints: 0=nose, 1=left_eye, 2=right_eye, 3=left_ear, 4=right_ear
    # Shoulders: 5=left_shoulder, 6=right_shoulder
    head_kps = [kp_xy[j] for j in range(5) if kp_conf[j] > 0.25]
    if head_kps:
        xs = [pt[0] for pt in head_kps]
        ys = [pt[1] for pt in head_kps]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)

        has_s5 = kp_conf[5] > 0.25
        has_s6 = kp_conf[6] > 0.25
        if has_s5 and has_s6:
            s_top = min(kp_xy[5][1], kp_xy[6][1])
            s_dist = abs(kp_xy[5][0] - kp_xy[6][0])
            head_w = max(s_dist * 0.52, (max_x - min_x) * 1.6, pw * 0.32)
        elif has_s5:
            s_top = kp_xy[5][1]
            head_w = max((max_x - min_x) * 1.6, pw * 0.32)
        elif has_s6:
            s_top = kp_xy[6][1]
            head_w = max((max_x - min_x) * 1.6, pw * 0.32)
        else:
            s_top = py1 + ph * 0.38
            head_w = max((max_x - min_x) * 1.6, pw * 0.32)

        cx = (min_x + max_x) / 2.0
        # Crown is near py1 or above min_y
        hy1 = max(0, int(min(py1, min_y - head_w * 0.45)))
        # Chin is near s_top or below max_y
        hy2 = min(img_h, int(min(s_top, max_y + head_w * 0.45)))
        hx1 = max(0, int(cx - head_w * 0.6))
        hx2 = min(img_w, int(cx + head_w * 0.6))
        if hx2 > hx1 and hy2 > hy1:
            return hx1, hy1, hx2, hy2, "pose_kpt"

    # --- 3. Fallback: Upper 28% of person bounding box ---
    head_h = ph * 0.28
    head_w = max(pw * 0.52, head_h * 0.8)
    cx = (px1 + px2) / 2.0
    hx1 = max(0, int(cx - head_w / 2.0))
    hx2 = min(img_w, int(cx + head_w / 2.0))
    hy1 = max(0, int(py1))
    hy2 = min(img_h, int(py1 + head_h))
    return hx1, hy1, hx2, hy2, "pose_box"


def detect_image_rois(img: np.ndarray) -> list[dict]:
    """
    Detects face / head ROIs in a static image.
    Uses YOLOv8-Pose for person/profile/sideways detection combined with
    YOLOv8-Face for close-up portraits.
    Applies IoU deduplication so each person has exactly one complete,
    properly covered ROI.
    """
    h_img, w_img = img.shape[:2]
    pose_model, face_model = load_detection_models()

    raw_rois = []

    # 1. Run Pose model (detects full/partial people and keypoints from any angle)
    pose_res = pose_model(img, conf=0.30, verbose=False)[0]

    # Run Face model (for close-up faces)
    face_boxes = []
    if face_model is not None:
        face_res = face_model(img, conf=0.40, verbose=False)[0]
        if face_res.boxes is not None and len(face_res.boxes) > 0:
            face_boxes = face_res.boxes.xyxy.cpu().numpy()

    # Extract head box for each person detected by pose
    if pose_res.boxes is not None and len(pose_res.boxes) > 0:
        boxes = pose_res.boxes.xyxy.cpu().numpy()
        kpts_xy = pose_res.keypoints.xy.cpu().numpy()
        kpts_conf = pose_res.keypoints.conf.cpu().numpy()

        for box, kp, conf in zip(boxes, kpts_xy, kpts_conf):
            hx1, hy1, hx2, hy2, _ = extract_head_box(box, kp, conf, face_boxes, w_img, h_img)
            w = hx2 - hx1
            h = hy2 - hy1
            if w > 10 and h > 10:
                raw_rois.append({"x": hx1, "y": hy1, "w": w, "h": h})

    # 2. Also check if there are standalone close-up face detections not covered by pose
    for fb in face_boxes:
        fx1, fy1, fx2, fy2 = map(int, fb[:4])
        fw, fh = fx2 - fx1, fy2 - fy1
        hx1 = max(0, int(fx1 - 0.20 * fw))
        hx2 = min(w_img, int(fx2 + 0.20 * fw))
        hy1 = max(0, int(fy1 - 0.25 * fh))
        hy2 = min(h_img, int(fy2 + 0.15 * fh))
        w = hx2 - hx1
        h = hy2 - hy1

        # Check if already covered by one of the pose head boxes
        already_covered = False
        for r in raw_rois:
            ix1, iy1 = max(hx1, r["x"]), max(hy1, r["y"])
            ix2, iy2 = min(hx2, r["x"] + r["w"]), min(hy2, r["y"] + r["h"])
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                union = (w * h) + (r["w"] * r["h"]) - inter
                if inter / max(1, union) > 0.35:
                    already_covered = True
                    break

        if not already_covered and w > 10 and h > 10:
            raw_rois.append({"x": hx1, "y": hy1, "w": w, "h": h})

    # 3. Deduplicate / Non-Maximum Suppression on raw_rois
    final_rois = []
    for r in raw_rois:
        merged = False
        for fr in final_rois:
            ix1 = max(r["x"], fr["x"])
            iy1 = max(r["y"], fr["y"])
            ix2 = min(r["x"] + r["w"], fr["x"] + fr["w"])
            iy2 = min(r["y"] + r["h"], fr["y"] + fr["h"])
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                union = (r["w"] * r["h"]) + (fr["w"] * fr["h"]) - inter
                if inter / max(1, union) > 0.40:
                    # Merge boxes to enclose both completely
                    nx1 = min(r["x"], fr["x"])
                    ny1 = min(r["y"], fr["y"])
                    nx2 = max(r["x"] + r["w"], fr["x"] + fr["w"])
                    ny2 = max(r["y"] + r["h"], fr["y"] + fr["h"])
                    fr["x"] = nx1
                    fr["y"] = ny1
                    fr["w"] = nx2 - nx1
                    fr["h"] = ny2 - ny1
                    merged = True
                    break
        if not merged:
            final_rois.append(r)

    return final_rois
