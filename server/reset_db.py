"""
reset_db.py
Script to reset database.json and clear all uploaded videos, images, and ROIs for a fresh start.

Usage:
    python reset_db.py              # Clears all videos, images, ROIs, and requests (keeps registered users)
    python reset_db.py --all        # Clears EVERYTHING including registered user accounts
"""

import os
import sys
import json
import shutil
import argparse

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SERVER_DIR, "database.json")
UPLOADS_DIR = os.path.join(SERVER_DIR, "uploads")
BASE_DIR = os.path.join(UPLOADS_DIR, "base")
ROIS_DIR = os.path.join(UPLOADS_DIR, "rois")
VIDEOS_DIR = os.path.join(UPLOADS_DIR, "videos")

DEFAULT_SCHEMA = {
    "users": [],
    "images": [],
    "rois": [],
    "access_requests": [],
    "videos": [],
    "video_persons": [],
    "video_access_requests": [],
}


def clear_directory(dir_path: str, name: str) -> int:
    """Removes all files and subdirectories in dir_path while preserving .gitkeep."""
    if not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)
        return 0

    deleted_count = 0
    for item in os.listdir(dir_path):
        if item == ".gitkeep":
            continue
        item_path = os.path.join(dir_path, item)
        try:
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)
            else:
                os.unlink(item_path)
            deleted_count += 1
        except Exception as e:
            print(f"  [Warning] Failed to remove {item_path}: {e}")

    # Ensure .gitkeep exists
    gitkeep = os.path.join(dir_path, ".gitkeep")
    if not os.path.exists(gitkeep):
        with open(gitkeep, "w") as f:
            f.write("")

    print(f"  [Cleared] {name}: removed {deleted_count} items")
    return deleted_count


def reset_database(clear_users: bool = False):
    print("=" * 60)
    print("RESETTING DATABASE & UPLOADS")
    print("=" * 60)

    # 1. Clear Upload Folders
    print("\n[1/2] Clearing Upload Directories...")
    clear_directory(VIDEOS_DIR, "uploads/videos")
    clear_directory(BASE_DIR, "uploads/base")
    clear_directory(ROIS_DIR, "uploads/rois")

    # 2. Reset database.json
    print("\n[2/2] Resetting database.json...")
    existing_users = []
    if not clear_users and os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                existing_users = data.get("users", [])
        except Exception:
            pass

    new_db = {
        "users": existing_users if not clear_users else [],
        "images": [],
        "rois": [],
        "access_requests": [],
        "videos": [],
        "video_persons": [],
        "video_access_requests": [],
    }

    # Backup previous database before overwriting
    if os.path.exists(DB_PATH):
        bak_path = DB_PATH + ".bak"
        try:
            shutil.copy2(DB_PATH, bak_path)
            print(f"  [Backup] Saved copy of prior database to: {os.path.basename(bak_path)}")
        except Exception:
            pass

    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(new_db, f, indent=2)

    if not clear_users and existing_users:
        user_names = [u.get("username", "Unknown") for u in existing_users]
        print(f"  [Preserved] {len(existing_users)} registered user(s): {', '.join(user_names)}")
    else:
        print("  [Reset] Users table wiped completely.")

    print("  [Reset] Videos, images, ROIs, and access requests reset to empty [].")
    print("\n" + "=" * 60)
    print("SUCCESS: Fresh start ready! You can now upload new videos/images.")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reset database and upload directories.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Wipe everything including registered user accounts (default: preserves users)",
    )
    args = parser.parse_args()
    reset_database(clear_users=args.all)
