import uuid
import os
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, PlainTextResponse
from pydantic import BaseModel
from db import db
from image_utils import process_image
from video_utils import process_video

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


# ── Phase 1: Auth ─────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    username: str
    role: str  # "user" | "admin"
    rsa_public_key: str
    mlkem_public_key: str = ""   # ML-KEM-768 public key (base64), optional for backward compat


class LoginRequest(BaseModel):
    username: str


@app.post("/signup")
def signup(body: SignupRequest):
    if db.find_one("users", username=body.username):
        raise HTTPException(400, "Username already exists")
    user = {"user_id": str(uuid.uuid4()), **body.model_dump()}
    db.insert("users", user)
    return {"user_id": user["user_id"]}


@app.post("/login")
def login(body: LoginRequest):
    user = db.find_one("users", username=body.username)
    if not user:
        raise HTTPException(404, "User not found")
    return user


class UpdateKeyRequest(BaseModel):
    user_id: str
    rsa_public_key: str
    mlkem_public_key: str = ""

@app.post("/update_public_key")
def update_public_key(body: UpdateKeyRequest):
    user = db.find_one("users", user_id=body.user_id)
    if not user:
        raise HTTPException(404, "User not found")
    updates = {"rsa_public_key": body.rsa_public_key}
    if body.mlkem_public_key:
        updates["mlkem_public_key"] = body.mlkem_public_key
    db.update_one("users", {"user_id": body.user_id}, updates)
    return {"status": "updated"}


# ── Phase 2: Image Upload ─────────────────────────────────────────────────────

@app.post("/upload")
async def upload(file: UploadFile = File(...), uploader_id: str = Form(...)):
    admin = db.find_one("users", user_id=uploader_id, role="admin")
    if not admin:
        raise HTTPException(400, "Uploader is not a registered admin")
    print(f"[upload] admin user_id: {admin['user_id']}")
    print(f"[upload] admin public_key FULL: {admin['rsa_public_key']}")

    image_bytes = await file.read()
    image_id, base_path, roi_records = process_image(image_bytes, admin["rsa_public_key"])

    db.insert("images", {
        "image_id": image_id,
        "uploader_id": uploader_id,
        "base_path": base_path,
        "filename": file.filename,
    })

    for r in roi_records:
        db.insert("rois", {
            "roi_id": r["roi_id"],
            "image_id": image_id,
            "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"],
            "roi_path": r["roi_path"],
            "admin_encrypted_aes_key": r["encrypted_aes_key"],
        })

    return {"image_id": image_id, "roi_count": len(roi_records)}


# ── Phase 3: Video Upload (ML-KEM pipeline) ───────────────────────────────────

@app.post("/upload_video")
async def upload_video(
    file: UploadFile = File(...),
    uploader_id: str = Form(...),
):
    admin = db.find_one("users", user_id=uploader_id, role="admin")
    if not admin:
        raise HTTPException(400, "Uploader is not a registered admin")

    mlkem_public_key = admin.get("mlkem_public_key", "")
    if not mlkem_public_key:
        raise HTTPException(400, "Admin has no ML-KEM public key registered. Please re-register your key.")

    video_bytes = await file.read()

    from video_utils import process_video
    result = process_video(video_bytes, mlkem_public_key, UPLOADS_DIR)

    video_id = result["video_id"]

    db.insert("videos", {
        "video_id": video_id,
        "uploader_id": uploader_id,
        "filename": file.filename,
        "masked_video_path": result["masked_video_path"],
        "roi_keys_path": result["roi_keys_path"],
        "metadata_path": result["metadata_path"],
        "fps": result["fps"],
        "width": result["width"],
        "height": result["height"],
        "total_frames": result["total_frames"],
        "person_count": len(result["persons"]),
    })

    for person in result["persons"]:
        db.insert("video_persons", {
            "person_id": str(uuid.uuid4()),
            "video_id": video_id,
            "track_id": person["track_id"],
            "frame_count": person["frame_count"],
            "admin_kem_ciphertext": person["kem_ciphertext_b64"],  # encapsulated with admin's ML-KEM key
        })

    return {
        "video_id": video_id,
        "person_count": len(result["persons"]),
        "total_frames": result["total_frames"],
        "persons": result["persons"],
    }


# ── Phase 4: Video Listing & Data ─────────────────────────────────────────────

@app.get("/videos")
def list_videos():
    return db.get("videos")


@app.get("/videos/{video_id}/persons")
def list_persons(video_id: str):
    return db.find_all("video_persons", video_id=video_id)


@app.get("/videos/{video_id}/masked")
def get_masked_video(video_id: str):
    video = db.find_one("videos", video_id=video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    path = video["masked_video_path"]
    if not os.path.exists(path):
        raise HTTPException(404, "Masked video file not found")
    return FileResponse(path, media_type="video/mp4", headers={
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    })


@app.get("/videos/{video_id}/persons/{track_id}/metadata")
def get_person_metadata(video_id: str, track_id: int):
    """Stream the JSONL metadata lines for a specific track_id."""
    video = db.find_one("videos", video_id=video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    metadata_path = video["metadata_path"]
    if not os.path.exists(metadata_path):
        raise HTTPException(404, "Metadata file not found")

    def generate_lines():
        with open(metadata_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("track_id") == track_id:
                        yield line + "\n"
                except Exception:
                    continue

    return StreamingResponse(generate_lines(), media_type="application/x-ndjson")


@app.get("/videos/{video_id}/persons/{track_id}/admin_kem_ciphertext")
def get_admin_kem_ciphertext(video_id: str, track_id: int):
    """Return the ML-KEM ciphertext that the admin used to encapsulate the AES key."""
    person = db.find_one("video_persons", video_id=video_id, track_id=track_id)
    if not person:
        raise HTTPException(404, "Person not found")
    return {"admin_kem_ciphertext": person["admin_kem_ciphertext"]}


# ── Phase 5: Video Access Management ─────────────────────────────────────────

class VideoAccessRequest(BaseModel):
    user_id: str
    video_id: str
    track_id: int


class ApproveVideoAccess(BaseModel):
    request_id: str
    user_kem_ciphertext: str   # new ciphertext encapsulated with user's ML-KEM public key


@app.post("/request_video_access")
def request_video_access(body: VideoAccessRequest):
    existing = db.find_one(
        "video_access_requests",
        user_id=body.user_id, video_id=body.video_id, track_id=body.track_id
    )
    if existing:
        return {"request_id": existing["request_id"], "status": existing["status"]}
    req = {
        "request_id": str(uuid.uuid4()),
        "user_id": body.user_id,
        "video_id": body.video_id,
        "track_id": body.track_id,
        "status": "pending",
        "user_kem_ciphertext": None,
    }
    db.insert("video_access_requests", req)
    return {"request_id": req["request_id"], "status": "pending"}


@app.get("/pending_video_requests")
def pending_video_requests():
    pending = db.find_all("video_access_requests", status="pending")
    result = []
    for req in pending:
        video = db.find_one("videos", video_id=req["video_id"])
        person = db.find_one("video_persons", video_id=req["video_id"], track_id=req["track_id"])
        user = db.find_one("users", user_id=req["user_id"])
        result.append({**req, "video": video, "person": person, "requester": user})
    return result


@app.post("/approve_video_access")
def approve_video_access(body: ApproveVideoAccess):
    req = db.find_one("video_access_requests", request_id=body.request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if not body.user_kem_ciphertext:
        raise HTTPException(400, "user_kem_ciphertext is required")
    db.update_one(
        "video_access_requests",
        {"request_id": body.request_id},
        {"status": "approved", "user_kem_ciphertext": body.user_kem_ciphertext}
    )
    updated = db.find_one("video_access_requests", request_id=body.request_id)
    return {"status": updated["status"], "key_saved": updated["user_kem_ciphertext"] is not None}


@app.get("/video_access/{user_id}/{video_id}/{track_id}")
def get_video_access(user_id: str, video_id: str, track_id: int):
    req = db.find_one(
        "video_access_requests",
        user_id=user_id, video_id=video_id, track_id=track_id
    )
    if not req:
        return {"status": "none", "approved": False, "user_kem_ciphertext": None}
    if req.get("status") != "approved" or not req.get("user_kem_ciphertext"):
        return {"status": req.get("status", "pending"), "approved": False, "user_kem_ciphertext": None}
    return {
        "status": "approved",
        "approved": True,
        "user_kem_ciphertext": req["user_kem_ciphertext"]
    }


# ── Phase 6: Image Data fetch endpoints ──────────────────────────────────────

class ResetRequest(BaseModel):
    admin_id: str

@app.post("/admin/reset_images")
def reset_images(body: ResetRequest):
    admin = db.find_one("users", user_id=body.admin_id, role="admin")
    if not admin:
        raise HTTPException(403, "Admin only")
    for roi in db.get("rois"):
        if os.path.exists(roi["roi_path"]):
            os.remove(roi["roi_path"])
    for img in db.get("images"):
        if os.path.exists(img["base_path"]):
            os.remove(img["base_path"])
    from db import _read, _write
    import threading
    data = _read()
    data["images"] = []
    data["rois"] = []
    data["access_requests"] = []
    _write(data)
    return {"status": "cleared"}


@app.get("/images")
def list_images():
    return db.get("images")


@app.get("/images/{image_id}/rois")
def list_rois(image_id: str):
    return db.find_all("rois", image_id=image_id)


@app.get("/rois/{roi_id}/encrypted_patch")
def get_encrypted_patch(roi_id: str):
    roi = db.find_one("rois", roi_id=roi_id)
    if not roi:
        raise HTTPException(404, "ROI not found")
    return FileResponse(roi["roi_path"], media_type="application/octet-stream")


@app.get("/rois/{roi_id}/admin_key")
def get_admin_key(roi_id: str):
    roi = db.find_one("rois", roi_id=roi_id)
    if not roi:
        raise HTTPException(404, "ROI not found")
    return {"admin_encrypted_aes_key": roi["admin_encrypted_aes_key"]}
class AccessRequest(BaseModel):
    user_id: str
    roi_id: str


@app.post("/request_access")
def request_access(body: AccessRequest):
    existing = db.find_one(
        "access_requests",
        user_id=body.user_id, roi_id=body.roi_id
    )
    if existing:
        return {"request_id": existing["request_id"], "status": existing["status"]}
    req = {
        "request_id": str(uuid.uuid4()),
        "user_id": body.user_id,
        "roi_id": body.roi_id,
        "status": "pending",
        "user_encrypted_aes_key": None,
    }
    db.insert("access_requests", req)
    return {"request_id": req["request_id"], "status": "pending"}



@app.get("/access/{user_id}/{roi_id}")
def get_access(user_id: str, roi_id: str):
    req = db.find_one("access_requests", user_id=user_id, roi_id=roi_id)
    if not req:
        return {"status": "none", "approved": False, "user_encrypted_aes_key": None}
    if req.get("status") != "approved" or not req.get("user_encrypted_aes_key"):
        return {"status": req.get("status", "pending"), "approved": False, "user_encrypted_aes_key": None}
    return {
        "status": "approved",
        "approved": True,
        "user_encrypted_aes_key": req["user_encrypted_aes_key"]
    }


@app.get("/users/{user_id}/public_key")
def get_public_key(user_id: str):
    user = db.find_one("users", user_id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return {
        "rsa_public_key": user["rsa_public_key"],
        "mlkem_public_key": user.get("mlkem_public_key", ""),
    }


@app.get("/pending_requests")
def pending_requests():
    pending = db.find_all("access_requests", status="pending")
    result = []
    for req in pending:
        roi = db.find_one("rois", roi_id=req["roi_id"])
        user = db.find_one("users", user_id=req["user_id"])
        result.append({**req, "roi": roi, "requester": user})
    return result


@app.post("/approve_access")
def approve_access(body: dict):
    from pydantic import BaseModel as BM
    request_id = body.get("request_id")
    encrypted_aes_key = body.get("encrypted_aes_key")
    req = db.find_one("access_requests", request_id=request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if not encrypted_aes_key:
        raise HTTPException(400, "encrypted_aes_key is required")
    db.update_one("access_requests",
                  {"request_id": request_id},
                  {"status": "approved", "user_encrypted_aes_key": encrypted_aes_key})
    updated = db.find_one("access_requests", request_id=request_id)
    return {"status": updated["status"], "key_saved": updated["user_encrypted_aes_key"] is not None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
