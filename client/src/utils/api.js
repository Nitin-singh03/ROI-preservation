const BASE = "http://localhost:8000";

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  signup: (data) =>
    fetch(`${BASE}/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  login: (data) =>
    fetch(`${BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),

  // ── Images ──────────────────────────────────────────────────────────────────
  upload: (formData) =>
    fetch(`${BASE}/upload`, { method: "POST", body: formData }).then(r => r.json()),
  listImages: () =>
    fetch(`${BASE}/images`).then(r => r.json()),
  listRois: (imageId) =>
    fetch(`${BASE}/images/${imageId}/rois`).then(r => r.json()),
  requestAccess: (data) =>
    fetch(`${BASE}/request_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  pendingRequests: () =>
    fetch(`${BASE}/pending_requests`).then(r => r.json()),
  approveAccess: (data) =>
    fetch(`${BASE}/approve_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  getAdminKey: (roiId) =>
    fetch(`${BASE}/rois/${roiId}/admin_key`).then(r => r.json()),
  getEncryptedPatch: (roiId) =>
    fetch(`${BASE}/rois/${roiId}/encrypted_patch`).then(r => r.arrayBuffer()),
  getAccess: (userId, roiId) =>
    fetch(`${BASE}/access/${userId}/${roiId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => (data && data.approved ? data : null))
      .catch(() => null),
  getUserPublicKey: (userId) =>
    fetch(`${BASE}/users/${userId}/public_key`).then(r => r.json()),
  baseImageUrl: (path) => `${BASE}/uploads/base/${path.split(/[\\/]/).pop()}`,

  // ── Videos (ML-KEM pipeline) ─────────────────────────────────────────────
  uploadVideo: (formData) =>
    fetch(`${BASE}/upload_video`, { method: "POST", body: formData }).then(r => r.json()),
  listVideos: () =>
    fetch(`${BASE}/videos`).then(r => r.json()),
  listPersons: (videoId) =>
    fetch(`${BASE}/videos/${videoId}/persons`).then(r => r.json()),
  maskedVideoUrl: (videoId) => `${BASE}/videos/${videoId}/masked`,
  getPersonMetadata: async (videoId, trackId) => {
    const res = await fetch(`${BASE}/videos/${videoId}/persons/${trackId}/metadata`);
    if (!res.ok) throw new Error("Failed to fetch metadata");
    const text = await res.text();
    return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  },
  getAdminKemCiphertext: (videoId, trackId) =>
    fetch(`${BASE}/videos/${videoId}/persons/${trackId}/admin_kem_ciphertext`).then(r => r.json()),
  requestVideoAccess: (data) =>
    fetch(`${BASE}/request_video_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  pendingVideoRequests: () =>
    fetch(`${BASE}/pending_video_requests`).then(r => r.json()),
  approveVideoAccess: (data) =>
    fetch(`${BASE}/approve_video_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  getVideoAccess: (userId, videoId, trackId) =>
    fetch(`${BASE}/video_access/${userId}/${videoId}/${trackId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => (data && data.approved ? data : null))
      .catch(() => null),

  // ── Misc ─────────────────────────────────────────────────────────────────
  updatePublicKey: (data) =>
    fetch(`${BASE}/update_public_key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
};
