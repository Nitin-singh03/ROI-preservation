import { useEffect, useState } from "react";
import { api } from "../utils/api";
import { rsaDecrypt, rsaEncrypt, getStoredPublicKey } from "../utils/cryptoUtils";
import { mlkemDecapsulate, mlkemEncapsulate, getStoredMlKemPublicKey } from "../utils/mlkemUtils";

export default function AdminDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("images"); // "images" | "videos"

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [keyMismatch, setKeyMismatch] = useState(false);
  const [reregisterStatus, setReregisterStatus] = useState("");

  // ── Images ─────────────────────────────────────────────────────────────────
  const [images, setImages] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState({});
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ── Videos ─────────────────────────────────────────────────────────────────
  const [videos, setVideos] = useState([]);
  const [videoRequests, setVideoRequests] = useState([]);
  const [videoStatus, setVideoStatus] = useState({});
  const [videoFile, setVideoFile] = useState(null);
  const [uploadVideoStatus, setUploadVideoStatus] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [newlyEncryptedVideo, setNewlyEncryptedVideo] = useState(null);

  useEffect(() => {
    fetchRequests();
    fetchVideoRequests();
    checkKeyMismatch();
    api.listImages().then(setImages);
    api.listVideos().then(setVideos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const localRsaKey = getStoredPublicKey(user.username);
    const localMlkemKey = getStoredMlKemPublicKey(user.username);
    if (!localRsaKey) {
      setReregisterStatus("No local RSA key found — please sign out and sign up again.");
      return;
    }
    setReregisterStatus("Updating...");
    try {
      const res = await api.updatePublicKey({
        user_id: user.user_id,
        rsa_public_key: localRsaKey,
        mlkem_public_key: localMlkemKey || "",
      });
      if (res.status === "updated") {
        setKeyMismatch(false);
        setReregisterStatus("✓ Keys updated. Delete old images and re-upload them.");
      } else {
        throw new Error(JSON.stringify(res));
      }
    } catch (err) {
      setReregisterStatus(`Error: ${err.message}`);
    }
  };

  const clearAndReupload = async () => {
    if (!window.confirm("This will delete ALL images, ROIs and access requests. Continue?")) return;
    await fetch("http://localhost:8000/admin/reset_images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: user.user_id }),
    });
    setReregisterStatus("✓ Images cleared. Re-upload your images now.");
    setImages([]);
    fetchRequests();
  };

  const fetchRequests = async () => setRequests(await api.pendingRequests());
  const fetchVideoRequests = async () => setVideoRequests(await api.pendingVideoRequests());

  // ── Image: Approve access ─────────────────────────────────────────────────
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

  // ── Image: Upload ─────────────────────────────────────────────────────────
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
      setUploadFile(null); setUploadPreview(null);
      api.listImages().then(setImages);
    } else {
      setUploadStatus(`Error: ${res.detail}`);
    }
    setUploading(false);
  };

  // ── Video: Approve access (ML-KEM re-encapsulation) ───────────────────────
  const approveVideoRequest = async (req) => {
    setVideoStatus(s => ({ ...s, [req.request_id]: "processing..." }));
    try {
      // 1. Get admin's ML-KEM ciphertext for this person
      const { admin_kem_ciphertext } = await api.getAdminKemCiphertext(req.video_id, req.track_id);

      // 2. ML-KEM decapsulate with admin's private key → recover shared AES key bytes
      const aesKeyBytes = await mlkemDecapsulate(user.username, admin_kem_ciphertext);

      // 3. Get user's ML-KEM public key
      const { mlkem_public_key } = await api.getUserPublicKey(req.user_id);
      if (!mlkem_public_key) throw new Error("User has no ML-KEM public key registered");

      // 4. Re-encapsulate the AES key with user's ML-KEM public key
      // We encrypt the raw aesKeyBytes via a new ML-KEM encapsulation, producing a shared secret,
      // then XOR-combine the aesKey with the shared secret to produce the user's ciphertext.
      // Actually: for simplicity and correctness, we create a new ML-KEM encapsulation
      // producing a new shared secret, then store: { kem_ct_b64, xored_aes_key_b64 }
      const { ciphertextB64, sharedSecretBytes } = await mlkemEncapsulate(mlkem_public_key);

      // XOR the aesKey with the sharedSecret so user can recover aesKey = sharedSecret XOR xoredKey
      const xoredKey = new Uint8Array(aesKeyBytes.length);
      for (let i = 0; i < aesKeyBytes.length; i++) {
        xoredKey[i] = aesKeyBytes[i] ^ sharedSecretBytes[i % sharedSecretBytes.length];
      }
      const xoredKeyB64 = btoa(String.fromCharCode(...xoredKey));

      // Combine: JSON { ct, xk } → user_kem_ciphertext field
      const userKemCiphertext = JSON.stringify({ ct: ciphertextB64, xk: xoredKeyB64 });

      await api.approveVideoAccess({ request_id: req.request_id, user_kem_ciphertext: userKemCiphertext });
      setVideoStatus(s => ({ ...s, [req.request_id]: "approved ✓" }));
      fetchVideoRequests();
    } catch (err) {
      setVideoStatus(s => ({ ...s, [req.request_id]: `Error: ${err.message}` }));
    }
  };

  // ── Video: Upload ─────────────────────────────────────────────────────────
  const handleVideoFileChange = (file) => {
    if (!file) return;
    setVideoFile(file);
    setUploadVideoStatus("");
    setNewlyEncryptedVideo(null);
  };

  const uploadVideo = async () => {
    if (!videoFile) return;
    setUploadingVideo(true);
    setUploadVideoStatus("Uploading & running YOLO tracking... This may take a few minutes.");
    setNewlyEncryptedVideo(null);

    const fd = new FormData();
    fd.append("file", videoFile);
    fd.append("uploader_id", user.user_id);
    try {
      const res = await api.uploadVideo(fd);
      if (res.video_id) {
        const encryptedRecord = {
          video_id: res.video_id,
          filename: videoFile.name || res.filename,
          person_count: res.person_count,
          total_frames: res.total_frames,
          fps: res.fps,
          width: res.width,
          height: res.height,
        };
        setNewlyEncryptedVideo(encryptedRecord);
        setUploadVideoStatus(`✓ Done! ${res.person_count} person${res.person_count !== 1 ? "s" : ""} detected across ${res.total_frames} frames.`);
        setVideoFile(null);
        api.listVideos().then(setVideos);
      } else {
        setUploadVideoStatus(`Error: ${res.detail || JSON.stringify(res)}`);
      }
    } catch (err) {
      setUploadVideoStatus(`Error: ${err.message}`);
    }
    setUploadingVideo(false);
  };

  // ── Shared tab button style ───────────────────────────────────────────────
  const tabBtn = (tab) => ({
    padding: "8px 20px", border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13, fontFamily: "inherit",
    borderRadius: 8, transition: "all 0.2s",
    background: activeTab === tab ? "#4f46e5" : "transparent",
    color: activeTab === tab ? "#fff" : "#64748b",
    boxShadow: activeTab === tab ? "0 2px 8px rgba(79,70,229,0.3)" : "none",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6fa", fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8eaf0", padding: "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a1a2e" }}>Admin Dashboard</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#9899a6" }}>
            Signed in as <span style={{ color: "#e05c63", fontWeight: 600 }}>{user.username}</span>
            <span style={{ marginLeft: 8, background: "#fff0f1", color: "#e05c63", fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid #fcc" }}>ADMIN</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { fetchRequests(); fetchVideoRequests(); }}
            style={{ background: "#f0f1ff", border: "1px solid #c7caff", color: "#5c63dd", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            ↻ Refresh Requests
          </button>
        </div>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1300, margin: "0 auto" }}>
        {/* Key Mismatch Warning */}
        {keyMismatch && (
          <div style={{ background: "#fffbea", border: "1px solid #f5e080", borderRadius: 12, padding: 20, marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700, color: "#7a6000" }}>Key Mismatch Detected</p>
                <p style={{ margin: "0 0 14px", fontSize: 13, color: "#9a7c00" }}>
                  The public key on the server doesn't match your browser. Re-register your key, then re-upload images.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={reregisterKey} style={{ background: "#f5c800", color: "#3a2e00", border: "none", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                    Re-register Keys
                  </button>
                  <button onClick={clearAndReupload} style={{ background: "#fff0f1", color: "#e05c63", border: "1px solid #fcc", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
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

        {/* Tab switcher */}
        <div style={{ display: "inline-flex", gap: 4, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 10, padding: 4, marginBottom: 28 }}>
          <button style={tabBtn("images")} onClick={() => setActiveTab("images")}>
            🖼️ Images
            {requests.length > 0 && <span style={{ marginLeft: 6, background: "#fecaca", color: "#dc2626", borderRadius: 12, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{requests.length}</span>}
          </button>
          <button style={tabBtn("videos")} onClick={() => setActiveTab("videos")}>
            🎬 Videos
            {videoRequests.length > 0 && <span style={{ marginLeft: 6, background: "#fecaca", color: "#dc2626", borderRadius: 12, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{videoRequests.length}</span>}
          </button>
        </div>

        {/* ═══ IMAGES TAB ═══════════════════════════════════════════════════ */}
        {activeTab === "images" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Upload Image */}
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
                    style={{ border: `2px dashed ${dragOver ? "#5c63dd" : "#d8daf0"}`, borderRadius: 10, padding: uploadPreview ? 0 : "32px 20px", textAlign: "center", cursor: "pointer", background: dragOver ? "#f4f5ff" : "#fafbff", transition: "all 0.2s", overflow: "hidden" }}
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
                  <input id="file-input" type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFileChange(e.target.files[0])} />
                  {uploadFile && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#5c63dd" }}>{uploadFile.name}</p>}
                  <button onClick={uploadImage} disabled={!uploadFile || uploading}
                    style={{ marginTop: 14, width: "100%", padding: "10px 0", background: uploadFile && !uploading ? "#5c63dd" : "#eef", color: uploadFile && !uploading ? "#fff" : "#bbb", border: "none", borderRadius: 8, cursor: uploadFile && !uploading ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 14, transition: "all 0.2s" }}>
                    {uploading ? "Processing..." : "Upload & Detect Regions"}
                  </button>
                  {uploadStatus && (
                    <p style={{ margin: "10px 0 0", fontSize: 13, textAlign: "center", color: uploadStatus.startsWith("✓") ? "#28a745" : uploadStatus.startsWith("Error") ? "#e05c63" : "#888" }}>
                      {uploadStatus}
                    </p>
                  )}
                </div>
              </div>

              {/* Uploaded images list */}
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
                    Uploaded Images <span style={{ fontSize: 12, color: "#bbb", fontWeight: 400 }}>({images.length})</span>
                  </h3>
                </div>
                <div style={{ padding: 16 }}>
                  {images.length === 0 ? (
                    <p style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "20px 0", margin: 0 }}>No images uploaded yet.</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {images.map(img => (
                        <div key={img.image_id} style={{ borderRadius: 10, overflow: "hidden", background: "#f5f6fa", border: "1px solid #e8eaf0" }}>
                          <div style={{ position: "relative", paddingTop: "60%", background: "#eee" }}>
                            <img src={api.baseImageUrl(img.base_path || img.image_id)} alt={img.filename}
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                              onError={e => { e.target.style.display = "none"; }} />
                            {img.roi_count != null && (
                              <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(255,255,255,0.9)", color: "#5c63dd", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, border: "1px solid #c7caff" }}>
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

            {/* Right: Image Pending Requests */}
            <PendingRequestsPanel requests={requests} status={status} onApprove={approve} />
          </div>
        )}

        {/* ═══ VIDEOS TAB ═══════════════════════════════════════════════════ */}
        {activeTab === "videos" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Upload Video */}
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>Upload Video</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#aaa" }}>
                    ML-KEM-768 encryption · YOLO person tracking
                  </p>
                </div>
                <div style={{ padding: 20 }}>
                  <div
                    onDragOver={e => { e.preventDefault(); setVideoDragOver(true); }}
                    onDragLeave={() => setVideoDragOver(false)}
                    onDrop={e => { e.preventDefault(); setVideoDragOver(false); handleVideoFileChange(e.dataTransfer.files[0]); }}
                    onClick={() => document.getElementById("video-file-input").click()}
                    style={{
                      border: `2px dashed ${videoDragOver ? "#6366f1" : "#d8daf0"}`,
                      borderRadius: 10, padding: "32px 20px", textAlign: "center",
                      cursor: "pointer", background: videoDragOver ? "#f4f5ff" : "#fafbff",
                      transition: "all 0.2s",
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
                    <p style={{ margin: 0, color: "#aaa", fontSize: 13 }}>
                      {videoFile ? (
                        <span style={{ color: "#6366f1", fontWeight: 600 }}>{videoFile.name}</span>
                      ) : (
                        <>Drop a video (.mp4) here or <span style={{ color: "#6366f1", fontWeight: 600 }}>click to browse</span></>
                      )}
                    </p>
                    {videoFile && (
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: "#aaa" }}>
                        {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    )}
                  </div>
                  <input id="video-file-input" type="file" accept="video/mp4,video/*" style={{ display: "none" }} onChange={e => handleVideoFileChange(e.target.files[0])} />

                  {/* ML-KEM notice */}
                  <div style={{ marginTop: 14, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 14 }}>🔐</span>
                    <p style={{ margin: 0, fontSize: 11, color: "#4338ca", lineHeight: 1.5 }}>
                      Each person's face will be AES-256-GCM encrypted and the key wrapped with <strong>ML-KEM-768</strong> (post-quantum).
                    </p>
                  </div>

                  <button onClick={uploadVideo} disabled={!videoFile || uploadingVideo}
                    style={{ marginTop: 14, width: "100%", padding: "10px 0", background: videoFile && !uploadingVideo ? "#6366f1" : "#eef", color: videoFile && !uploadingVideo ? "#fff" : "#bbb", border: "none", borderRadius: 8, cursor: videoFile && !uploadingVideo ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 14, transition: "all 0.2s", fontFamily: "inherit" }}>
                    {uploadingVideo ? "⚙ Processing... (may take minutes)" : "🚀 Upload & Encrypt Video"}
                  </button>

                  {uploadVideoStatus && (
                    <div style={{
                      marginTop: 14,
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: uploadVideoStatus.startsWith("✓") ? "#f0fdf4" : uploadVideoStatus.startsWith("Error") ? "#fef2f2" : "#f8fafc",
                      border: `1px solid ${uploadVideoStatus.startsWith("✓") ? "#bbf7d0" : uploadVideoStatus.startsWith("Error") ? "#fecaca" : "#e2e8f0"}`,
                      textAlign: "center"
                    }}>
                      <p style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: uploadVideoStatus.startsWith("✓") ? "#16a34a" : uploadVideoStatus.startsWith("Error") ? "#dc2626" : "#64748b",
                        lineHeight: 1.5
                      }}>
                        {uploadVideoStatus}
                      </p>
                      {newlyEncryptedVideo && uploadVideoStatus.startsWith("✓") && (
                        <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
                          <button
                            onClick={() => setPlayingVideo(newlyEncryptedVideo)}
                            style={{
                              padding: "8px 18px",
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontWeight: 700,
                              fontSize: 13,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              boxShadow: "0 2px 8px rgba(22,163,74,0.35)",
                              transition: "all 0.2s"
                            }}
                          >
                            <span>▶</span> Play Encrypted Video Now
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Uploaded videos list */}
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
                  <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
                    Uploaded Videos <span style={{ fontSize: 12, color: "#bbb", fontWeight: 400 }}>({videos.length})</span>
                  </h3>
                </div>
                <div style={{ padding: 16 }}>
                  {videos.length === 0 ? (
                    <p style={{ color: "#ccc", fontSize: 13, textAlign: "center", padding: "20px 0", margin: 0 }}>No videos uploaded yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {videos.map(vid => (
                        <div key={vid.video_id} style={{ borderRadius: 10, background: "#f5f6fa", border: "1px solid #e8eaf0", padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            onClick={() => setPlayingVideo(vid)}
                            style={{ width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg, #1e1b4b, #4338ca)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, cursor: "pointer" }}
                            title="Click to play"
                          >
                            🎬
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {vid.filename || vid.video_id.slice(0, 16)}
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#aaa" }}>
                              {vid.person_count || 0} persons · {vid.total_frames || "?"} frames
                            </p>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ background: "#e0e7ff", color: "#4338ca", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 12, whiteSpace: "nowrap" }}>
                              ML-KEM-768
                            </div>
                            <button
                              onClick={() => setPlayingVideo(vid)}
                              style={{
                                background: "#4f46e5",
                                color: "#fff",
                                border: "none",
                                borderRadius: 6,
                                padding: "6px 12px",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                transition: "background 0.2s"
                              }}
                            >
                              ▶ Play
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Video Pending Requests */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
                  Pending Video Requests
                  {videoRequests.length > 0 && (
                    <span style={{ marginLeft: 8, background: "#fff0f1", color: "#e05c63", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>
                      {videoRequests.length}
                    </span>
                  )}
                </h3>
              </div>
              <div style={{ padding: 16 }}>
                {videoRequests.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#ccc" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                    <p style={{ margin: 0, fontSize: 13 }}>No pending video requests</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {videoRequests.map(req => {
                      const st = videoStatus[req.request_id];
                      const approved = st === "approved ✓";
                      const errored = st?.startsWith("Error");
                      return (
                        <div key={req.request_id} style={{
                          background: "#fafbff", borderRadius: 10,
                          border: `1px solid ${approved ? "#c3e6cb" : errored ? "#f5c6cb" : "#e8eaf0"}`,
                          padding: 14, transition: "border-color 0.3s",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #818cf8, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                              {(req.requester?.username || "?")[0].toUpperCase()}
                            </div>
                            <div>
                              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>
                                {req.requester?.username || req.user_id.slice(0, 8)}
                              </p>
                              <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                                Person {req.track_id} · {req.video?.filename || req.video_id?.slice(0, 12)}
                              </p>
                            </div>
                          </div>
                          {/* ML-KEM badge */}
                          <div style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 5, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 20, padding: "2px 8px", fontSize: 10, color: "#4338ca", fontWeight: 700 }}>
                            🔐 ML-KEM-768 Re-encapsulation
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {!approved && (
                              <button onClick={() => approveVideoRequest(req)} disabled={!!st}
                                style={{ background: st ? "#f0f1f5" : "#4f46e5", color: st ? "#bbb" : "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: st ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                                {st === "processing..." ? "Processing..." : "Approve"}
                              </button>
                            )}
                            {st && (
                              <span style={{ fontSize: 12, color: approved ? "#28a745" : errored ? "#e05c63" : "#888" }}>{st}</span>
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
        )}
      </div>

      {/* ── Encrypted Video Player Modal ─────────────────────────────────────── */}
      {playingVideo && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => setPlayingVideo(null)}
        >
          <div
            style={{
              background: "#0f172a",
              color: "#f8fafc",
              borderRadius: 16,
              border: "1px solid #334155",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
              width: "100%",
              maxWidth: 860,
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #1e293b",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#1e293b",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>🎬</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>
                    {playingVideo.filename || `Video ${playingVideo.video_id.slice(0, 12)}`}
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>
                    Encrypted Masked Video (AES-256-GCM + ML-KEM-768)
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    background: "rgba(99, 102, 241, 0.2)",
                    color: "#a5b4fc",
                    border: "1px solid rgba(99, 102, 241, 0.4)",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 20,
                  }}
                >
                  🔒 ROI ENCRYPTED
                </span>
                <button
                  onClick={() => setPlayingVideo(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: 22,
                    cursor: "pointer",
                    lineHeight: 1,
                    padding: 4,
                    borderRadius: 6,
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={(e) => (e.target.style.color = "#fff")}
                  onMouseLeave={(e) => (e.target.style.color = "#94a3b8")}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Video Content */}
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#000",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                <video
                  key={playingVideo.video_id}
                  src={api.maskedVideoUrl(playingVideo.video_id)}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  style={{ width: "100%", maxHeight: "55vh", display: "block", background: "#000" }}
                />
              </div>

              {/* Video Metadata Cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    background: "#1e293b",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: "1px solid #334155",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8", display: "block" }}>Persons / Faces Masked</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#38bdf8" }}>
                    {playingVideo.person_count || 0} Persons
                  </span>
                </div>

                <div
                  style={{
                    background: "#1e293b",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: "1px solid #334155",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8", display: "block" }}>Total Frames</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>
                    {playingVideo.total_frames || "?"} frames
                  </span>
                </div>

                <div
                  style={{
                    background: "#1e293b",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: "1px solid #334155",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8", display: "block" }}>Frame Rate & Resolution</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                    {playingVideo.fps ? `${playingVideo.fps} FPS` : "Standard"} ·{" "}
                    {playingVideo.width && playingVideo.height ? `${playingVideo.width}x${playingVideo.height}` : "HD"}
                  </span>
                </div>

                <div
                  style={{
                    background: "#1e293b",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: "1px solid #334155",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#94a3b8", display: "block" }}>Post-Quantum Encryption</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>
                    ML-KEM-768
                  </span>
                </div>
              </div>

              {/* Security info banner */}
              <div
                style={{
                  background: "rgba(99, 102, 241, 0.1)",
                  border: "1px solid rgba(99, 102, 241, 0.25)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontSize: 12,
                  color: "#c7d2fe",
                  lineHeight: 1.5,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 16 }}>🛡️</span>
                <div>
                  <strong>ROI Encryption Preserved:</strong> All detected face regions in this stream are scrambled
                  with AES-256-GCM encryption. The corresponding decryption keys are encapsulated with post-quantum
                  ML-KEM-768 and can be delegated to users per-person upon approval.
                </div>
              </div>

              {/* Footer actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 12,
                  paddingTop: 8,
                  borderTop: "1px solid #1e293b",
                }}
              >
                <a
                  href={api.maskedVideoUrl(playingVideo.video_id)}
                  download={playingVideo.filename ? `masked_${playingVideo.filename}` : "masked_video.mp4"}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "8px 16px",
                    background: "#334155",
                    color: "#f8fafc",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "background 0.2s",
                  }}
                >
                  <span>⬇</span> Download Masked MP4
                </a>
                <button
                  onClick={() => setPlayingVideo(null)}
                  style={{
                    padding: "8px 20px",
                    background: "#4f46e5",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 0.2s",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared image pending requests panel ──────────────────────────────────────
function PendingRequestsPanel({ requests, status, onApprove }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5" }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>
          Pending Image Requests
          {requests.length > 0 && (
            <span style={{ marginLeft: 8, background: "#fff0f1", color: "#e05c63", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>
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
                  padding: 14, transition: "border-color 0.3s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #7c83ff, #5c63dd)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                      {(req.requester?.username || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>
                        {req.requester?.username || req.user_id.slice(0, 8)}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>ROI {req.roi_id.slice(0, 8)}</p>
                    </div>
                  </div>
                  {req.roi && (
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "#bbb", fontFamily: "monospace" }}>
                      x={req.roi.x} y={req.roi.y} w={req.roi.w} h={req.roi.h}
                    </p>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {!approved && (
                      <button onClick={() => onApprove(req)} disabled={!!st}
                        style={{ background: st ? "#f0f1f5" : "#28a745", color: st ? "#bbb" : "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: st ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                        {st === "processing..." ? "Processing..." : "Approve"}
                      </button>
                    )}
                    {st && (
                      <span style={{ fontSize: 12, color: approved ? "#28a745" : errored ? "#e05c63" : "#888" }}>{st}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
