import cv2
import os
import json
import base64
import argparse
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes, serialization

def load_wrapped_keys(keys_path, metadata_path):
    """Load wrapped keys from roi_keys.json or stream scan metadata_path."""
    if os.path.exists(keys_path):
        try:
            with open(keys_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("wrapped_keys", {})
        except Exception:
            pass
            
    # Fallback if keys_path doesn't exist: check metadata_path line-by-line
    if os.path.exists(metadata_path):
        with open(metadata_path, "r", encoding="utf-8") as f:
            for line in f:
                if '"wrapped_keys"' in line:
                    try:
                        data = json.loads(line)
                        if "wrapped_keys" in data:
                            return data["wrapped_keys"]
                    except Exception:
                        pass
    return {}

def stream_target_rois(metadata_path, target_id):
    """Stream read JSON/JSONL line by line and collect ROIs only for target_id."""
    frame_roi_map = {}
    roi_count = 0
    
    with open(metadata_path, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str or line_str.startswith("[") or line_str.startswith("]") or (line_str.startswith("{") and '"wrapped_keys"' in line_str):
                continue
            
            # Remove trailing comma if legacy formatted json array
            if line_str.endswith(","):
                line_str = line_str[:-1]
                
            try:
                item = json.loads(line_str)
                if isinstance(item, dict) and item.get("track_id") == target_id:
                    f_idx = item["frame_index"]
                    if f_idx not in frame_roi_map:
                        frame_roi_map[f_idx] = []
                    frame_roi_map[f_idx].append(item)
                    roi_count += 1
            except Exception:
                continue
                
    return frame_roi_map, roi_count

def main():
    parser = argparse.ArgumentParser(description="Decrypt and reveal ROI for a specific person ID in a masked video.")
    parser.add_argument("--id", type=int, help="Target Person / Track ID to decrypt.")
    parser.add_argument("--video", type=str, default="masked_output.mp4", help="Path to masked input video.")
    parser.add_argument("--metadata", type=str, default=None, help="Path to ROI metadata file (.jsonl or .json).")
    parser.add_argument("--keys", type=str, default="roi_keys.json", help="Path to wrapped keys JSON file.")
    parser.add_argument("--key", type=str, default="private_key.pem", help="Path to administrator RSA private key file.")
    parser.add_argument("--output", type=str, default=None, help="Path for decrypted output video file.")
    parser.add_argument("--no-preview", action="store_true", help="Disable GUI live preview window.")
    args = parser.parse_args()

    # Determine metadata path
    metadata_path = args.metadata
    if metadata_path is None:
        if os.path.exists("roi_metadata.jsonl"):
            metadata_path = "roi_metadata.jsonl"
        else:
            metadata_path = "roi_metadata.json"

    # 1. Validate required files exist
    for fpath in [args.video, args.key]:
        if not os.path.exists(fpath):
            print(f"Error: Required file '{fpath}' not found.")
            print("Please run 'yolo_mask.py' first to generate masked_output.mp4 and private_key.pem.")
            return

    # 2. Load RSA Private Key
    print(f"Loading private key from '{args.key}'...")
    with open(args.key, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    # 3. Load Wrapped Keys
    wrapped_keys = load_wrapped_keys(args.keys, metadata_path)
    if not wrapped_keys:
        print("Error: No wrapped keys found in keys file or metadata file.")
        return

    available_ids = [int(k) for k in wrapped_keys.keys()]
    available_ids.sort()
    print(f"\nAvailable Person IDs in metadata: {available_ids}")

    # 4. Prompt for target ID if not passed as CLI argument
    target_id = args.id
    if target_id is None:
        try:
            user_input = input(f"Enter the ID of the person to decrypt ({available_ids}): ").strip()
            target_id = int(user_input)
        except ValueError:
            print("Error: Invalid ID entered. Must be an integer.")
            return

    str_target_id = str(target_id)
    if str_target_id not in wrapped_keys and target_id not in wrapped_keys:
        print(f"Error: Person ID {target_id} not found in metadata. Available IDs: {available_ids}")
        return

    # 5. Unwrap AES Key for target_id
    wrapped_key_b64 = wrapped_keys.get(str_target_id) or wrapped_keys.get(target_id)
    wrapped_key_bytes = base64.b64decode(wrapped_key_b64)

    try:
        aes_key = private_key.decrypt(
            wrapped_key_bytes,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )
        aesgcm = AESGCM(aes_key)
        print(f"Successfully unwrapped AES-256 key for Person ID: {target_id}")
    except Exception as e:
        print(f"Failed to unwrap AES key using private key: {e}")
        return

    # 6. Stream load ROIs matching target_id
    print(f"Streaming ROI metadata from '{metadata_path}' for Person ID {target_id}...")
    frame_roi_map, total_rois = stream_target_rois(metadata_path, target_id)
    print(f"Loaded {total_rois} ROI payloads across {len(frame_roi_map)} frames for Person ID {target_id}.")

    # 7. Setup Video Reader & Writer
    cap = cv2.VideoCapture(args.video)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS))

    output_filename = args.output or f"decrypted_person_{target_id}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_filename, fourcc, fps, (width, height))

    print(f"Processing '{args.video}' to decrypt Person ID {target_id}...")
    frame_idx = 0
    decrypted_patches_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx in frame_roi_map:
            for item in frame_roi_map[frame_idx]:
                hx1, hy1, w, h = item["bbox"]
                hx2, hy2 = hx1 + w, hy1 + h

                try:
                    iv = base64.b64decode(item["iv"])
                    ciphertext = base64.b64decode(item["ciphertext"])
                    tag = base64.b64decode(item["tag"])
                    
                    encrypted_payload = ciphertext + tag
                    decrypted_bytes = aesgcm.decrypt(iv, encrypted_payload, None)

                    # Reconstruct raw bytes to image patch
                    patch = np.frombuffer(decrypted_bytes, dtype=np.uint8).reshape((h, w, 3))

                    # Overlay decrypted patch back onto blacked-out ROI
                    frame[hy1:hy2, hx1:hx2] = patch

                    # Draw bounding box and label for decrypted person
                    cv2.rectangle(frame, (hx1, hy1), (hx2, hy2), (0, 255, 0), 2)
                    cv2.putText(frame, f"ID: {target_id} (Decrypted)", (hx1, max(hy1 - 8, 15)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

                    decrypted_patches_count += 1
                except Exception as e:
                    print(f"Frame {frame_idx}: Decryption error - {e}")

        out.write(frame)

        if not args.no_preview:
            cv2.imshow(f"Decrypted Person ID {target_id} (Press 'q' to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                print("User stopped preview.")
                break

        frame_idx += 1

    cap.release()
    out.release()
    if not args.no_preview:
        cv2.destroyAllWindows()

    print("\nDecryption complete!")
    print(f" - Output saved to: {output_filename}")
    print(f" - Restored {decrypted_patches_count} ROI patches across {frame_idx} frames.")

if __name__ == "__main__":
    main()
