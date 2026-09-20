import { useEffect, useState } from "react";
import { api } from "../utils/api";
import { rsaDecrypt, rsaEncrypt, getStoredPublicKey } from "../utils/cryptoUtils";

export default function AdminDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [images, setImages] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState({});
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [keyMismatch, setKeyMismatch] = useState(false);
  const [reregisterStatus, setReregisterStatus] = useState("");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetchRequests();
    checkKeyMismatch();
    api.listImages().then(setImages);
  }, []);

  const checkKeyMismatch = async () => {
    try {
      const serverData = await api.getUserPublicKey(user.user_id);
      const localPublicKey = getStoredPublicKey(user.username);
      if (!localPublicKey) { setKeyMismatch(true); return; }
      setKeyMismatch(serverData.rsa_public_key.trim() !== localPublicKey.trim());
    } catch { setKeyMismatch(true); }
  };

  const reregisterKey = async () => {
    const localPublicKey = getStoredPublicKey(user.username);
    if (!localPublicKey) {
      setReregisterStatus("No local key found — please sign out and sign up again.");
      return;
    }
    setReregisterStatus("Updating...");
    try {
      const res = await fetch("http://localhost:8000/update_public_key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.user_id, rsa_public_key: localPublicKey })
      });
      if (!res.ok) throw new Error(await res.text());
      setKeyMismatch(false);
      setReregisterStatus("✓ Key updated. Delete old images and re-upload them.");
    } catch (err) {
      setReregisterStatus(`Error: ${err.message}`);
    }
  };

  const clearAndReupload = async () => {
    if (!window.confirm("This will delete ALL images, ROIs and access requests. Continue?")) return;
    await fetch("http://localhost:8000/admin/reset_images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: user.user_id })
    });
    setReregisterStatus("✓ Images cleared. Re-upload your images now.");
    setImages([]);
    fetchRequests();
  };

  const fetchRequests = async () => setRequests(await api.pendingRequests());

  const approve = async (req) => {
    setStatus(s => ({ ...s, [req.request_id]: "processing..." }));
    try {
      const { admin_encrypted_aes_key } = await api.getAdminKey(req.roi_id);
      const aesKeyBytes = await rsaDecrypt(user.username, admin_encrypted_aes_key);
      const { rsa_public_key } = await api.getUserPublicKey(req.user_id);
      const userEncryptedKey = await rsaEncrypt(rsa_public_key, aesKeyBytes);
      await api.approveAccess({ request_id: req.request_id, encrypted_aes_key: userEncryptedKey });
      setStatus(s => ({ ...s, [req.request_id]: "approved ✓" }));
      fetchRequests();
    } catch (err) {
      const msg = err.name === "OperationError"
        ? "Key mismatch — re-register your public key and re-upload the image."
        : err.message;
      setStatus(s => ({ ...s, [req.request_id]: `Error: ${msg}` }));
    }
  };

  const handleFileChange = (file) => {
    if (!file) return;
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
    setUploadStatus("");
  };

  const uploadImage = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadStatus("Uploading & detecting regions...");
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("uploader_id", user.user_id);
    const res = await api.upload(fd);
    if (res.image_id) {
      setUploadStatus(`✓ Done! ${res.roi_count} region${res.roi_count !== 1 ? "s" : ""} detected.`);
      setUploadFile(null);
      setUploadPreview(null);
      api.listImages().then(setImages);
    } else {
      setUploadStatus(`Error: ${res.detail}`);
    }
    setUploading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e8eaf0",
        padding: "20px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a1a2e" }}>Admin Dashboard</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#9899a6" }}>
            Signed in as <span style={{ color: "#e05c63", fontWeight: 600 }}>{user.username}</span>
            <span style={{
              marginLeft: 8, background: "#fff0f1", color: "#e05c63",
              fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
              border: "1px solid #fcc"
            }}>ADMIN</span>
          </p>
        </div>
        <button
          onClick={fetchRequests}
          style={{
            background: "#f0f1ff", border: "1px solid #c7caff",
            color: "#5c63dd", padding: "8px 18px", borderRadius: 8,
            cursor: "pointer", fontSize: 13, fontWeight: 600
          }}
        >
          ↻ Refresh Requests
        </button>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Key Mismatch Warning */}
        {keyMismatch && (
          <div style={{
            background: "#fffbea", border: "1px solid #f5e080",
            borderRadius: 12, padding: 20, marginBottom: 28
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#7a6000" }}>Key Mismatch Detected</p>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "#9a7c00" }}>
                  The public key on the server doesn't match your browser. Re-register your key, then re-upload images.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={reregisterKey} style={{
                    background: "#f5c800", color: "#3a2e00", border: "none",
                    padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
                  }}>
                    Re-register Key
                  </button>
                  <button onClick={clearAndReupload} style={{
                    background: "#fff0f1", color: "#e05c63", border: "1px solid #fcc",
                    padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13
                  }}>
                    Clear All Images
                  </button>
                </div>
                {reregisterStatus && (
                  <p style={{ margin: "10px 0 0", fontSize: 13, color: reregisterStatus.startsWith("✓") ? "#28a745" : "#e05c63" }}>
                    {reregisterStatus}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Upload */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>Upload Image</h3>
              </div>
              <div style={{ padding: 20 }}>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFileChange(e.dataTransfer.files[0]); }}
                  onClick={() => document.getElementById("file-input").click()}
                  style={{
                    border: `2px dashed ${dragOver ? "#5c63dd" : "#d8daf0"}`,
                    borderRadius: 10, padding: uploadPreview ? 0 : "32px 20px",
                    textAlign: "center", cursor: "pointer",
                    background: dragOver ? "#f4f5ff" : "#fafbff",
                    transition: "all 0.2s", overflow: "hidden"
                  }}
                >
                  {uploadPreview ? (
                    <img src={uploadPreview} alt="preview" style={{ width: "100%", display: "block", borderRadius: 8 }} />
                  ) : (
                    <>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>🖼️</div>
                      <p style={{ margin: 0, color: "#aaa", fontSize: 13 }}>
                        Drop an image here or <span style={{ color: "#5c63dd", fontWeight: 600 }}>click to browse</span>
                      </p>
                    </>
                  )}
                </div>
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={e => handleFileChange(e.target.files[0])}
                />
                {uploadFile && (
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "#5c63dd" }}>{uploadFile.name}</p>
                )}
                <button
                  onClick={uploadImage}
                  disabled={!uploadFile || uploading}
                  style={{
                    marginTop: 14, width: "100%", padding: "10px 0",
                    background: uploadFile && !uploading ? "#5c63dd" : "#eef",
                    color: uploadFile && !uploading ? "#fff" : "#bbb",
                    border: "none", borderRadius: 8,
                    cursor: uploadFile && !uploading ? "pointer" : "not-allowed",
                    fontWeight: 600, fontSize: 14, transition: "all 0.2s"
                  }}
                >
                  {uploading ? "Processing..." : "Upload & Detect Regions"}
                </button>
                {uploadStatus && (
                  <p style={{
                    margin: "10px 0 0", fontSize: 13, textAlign: "center",
                    color: uploadStatus.startsWith("✓") ? "#28a745" : uploadStatus.startsWith("Error") ? "#e05c63" : "#888"
                  }}>
                    {uploadStatus}
                  </p>
                )}
              </div>
            </div>

            {/* Uploaded images */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
                  Uploaded Images
                  <span style={{ marginLeft: 8, fontSize: 12, color: "#bbb", fontWeight: 400 }}>({images.length})</span>
                </h3>
              </div>
              <div style={{ padding: 16 }}>
                {images.length === 0 ? (
                  <p style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "20px 0", margin: 0 }}>
                    No images uploaded yet.
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {images.map(img => (
                      <div key={img.image_id} style={{ borderRadius: 10, overflow: "hidden", background: "#f5f6fa", border: "1px solid #e8eaf0" }}>
                        <div style={{ position: "relative", paddingTop: "60%", background: "#eee" }}>
                          <img
                            src={api.baseImageUrl(img.base_path || img.image_id)}
                            alt={img.filename}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                            onError={e => { e.target.style.display = "none"; }}
                          />
                          {img.roi_count != null && (
                            <div style={{
                              position: "absolute", top: 6, left: 6,
                              background: "rgba(255,255,255,0.9)", color: "#5c63dd",
                              fontSize: 10, fontWeight: 700, padding: "2px 7px",
                              borderRadius: 20, border: "1px solid #c7caff"
                            }}>
                              {img.roi_count} ROI{img.roi_count !== 1 ? "s" : ""}
                            </div>
                          )}
                        </div>
                        <div style={{ padding: "8px 10px" }}>
                          <p style={{ margin: 0, fontSize: 11, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {img.filename || img.image_id.slice(0, 12)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column — Pending Requests */}
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
                Pending Requests
                {requests.length > 0 && (
                  <span style={{
                    marginLeft: 8, background: "#fff0f1", color: "#e05c63",
                    fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700
                  }}>
                    {requests.length}
                  </span>
                )}
              </h3>
            </div>
            <div style={{ padding: 16 }}>
              {requests.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#ccc" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                  <p style={{ margin: 0, fontSize: 13 }}>No pending requests</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {requests.map(req => {
                    const st = status[req.request_id];
                    const approved = st === "approved ✓";
                    const errored = st?.startsWith("Error");
                    return (
                      <div key={req.request_id} style={{
                        background: "#fafbff", borderRadius: 10,
                        border: `1px solid ${approved ? "#c3e6cb" : errored ? "#f5c6cb" : "#e8eaf0"}`,
                        padding: 14, transition: "border-color 0.3s"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: "50%",
                            background: "linear-gradient(135deg, #7c83ff, #5c63dd)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0
                          }}>
                            {(req.requester?.username || "?")[0].toUpperCase()}
                          </div>
                          <div>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>
                              {req.requester?.username || req.user_id.slice(0, 8)}
                            </p>
                            <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                              ROI {req.roi_id.slice(0, 8)}
                            </p>
                          </div>
                        </div>
                        {req.roi && (
                          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#bbb", fontFamily: "monospace" }}>
                            x={req.roi.x} y={req.roi.y} w={req.roi.w} h={req.roi.h}
                          </p>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {!approved && (
                            <button
                              onClick={() => approve(req)}
                              disabled={!!st}
                              style={{
                                background: st ? "#f0f1f5" : "#28a745",
                                color: st ? "#bbb" : "#fff",
                                border: "none", borderRadius: 6, padding: "6px 16px",
                                cursor: st ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600
                              }}
                            >
                              {st === "processing..." ? "Processing..." : "Approve"}
                            </button>
                          )}
                          {st && (
                            <span style={{ fontSize: 12, color: approved ? "#28a745" : errored ? "#e05c63" : "#888" }}>
                              {st}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
