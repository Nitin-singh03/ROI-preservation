import uuid
import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from db import db
from image_utils import process_image

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ── Phase 1: Auth ─────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    username: str
    role: str  # "user" | "admin"
    rsa_public_key: str


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

@app.post("/update_public_key")
def update_public_key(body: UpdateKeyRequest):
    user = db.find_one("users", user_id=body.user_id)
    if not user:
        raise HTTPException(404, "User not found")
    db.update_one("users", {"user_id": body.user_id}, {"rsa_public_key": body.rsa_public_key})
    return {"status": "updated"}


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


# ── Phase 3: Access Management ────────────────────────────────────────────────

class AccessRequest(BaseModel):
    user_id: str
    roi_id: str


class ApproveRequest(BaseModel):
    request_id: str
    encrypted_aes_key: str  # re-encrypted with user's public key


@app.post("/request_access")
def request_access(body: AccessRequest):
    existing = db.find_one("access_requests", user_id=body.user_id, roi_id=body.roi_id)
    if existing:
        return {"request_id": existing["request_id"], "status": existing["status"]}
    req = {"request_id": str(uuid.uuid4()), "user_id": body.user_id,
           "roi_id": body.roi_id, "status": "pending", "user_encrypted_aes_key": None}
    db.insert("access_requests", req)
    return {"request_id": req["request_id"], "status": "pending"}


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
def approve_access(body: ApproveRequest):
    req = db.find_one("access_requests", request_id=body.request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if not body.encrypted_aes_key:
        raise HTTPException(400, "encrypted_aes_key is required")
    db.update_one("access_requests",
                  {"request_id": body.request_id},
                  {"status": "approved", "user_encrypted_aes_key": body.encrypted_aes_key})
    # Verify it was saved
    updated = db.find_one("access_requests", request_id=body.request_id)
    return {"status": updated["status"], "key_saved": updated["user_encrypted_aes_key"] is not None}


# ── Phase 6: Data fetch endpoints ─────────────────────────────────────────────

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
    from fastapi.responses import FileResponse
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


@app.get("/access/{user_id}/{roi_id}")
def get_access(user_id: str, roi_id: str):
    req = db.find_one("access_requests", user_id=user_id, roi_id=roi_id)
    if not req:
        raise HTTPException(404, "No access request found")
    if req["status"] != "approved" or not req["user_encrypted_aes_key"]:
        raise HTTPException(404, f"Access not approved yet (status: {req['status']})")
    return {"user_encrypted_aes_key": req["user_encrypted_aes_key"]}


@app.get("/users/{user_id}/public_key")
def get_public_key(user_id: str):
    user = db.find_one("users", user_id=user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return {"rsa_public_key": user["rsa_public_key"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
