const BASE = "http://localhost:8000";

export const api = {
  signup: (data) => fetch(`${BASE}/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  login: (data) => fetch(`${BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  upload: (formData) => fetch(`${BASE}/upload`, { method: "POST", body: formData }).then(r => r.json()),
  listImages: () => fetch(`${BASE}/images`).then(r => r.json()),
  listRois: (imageId) => fetch(`${BASE}/images/${imageId}/rois`).then(r => r.json()),
  requestAccess: (data) => fetch(`${BASE}/request_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  pendingRequests: () => fetch(`${BASE}/pending_requests`).then(r => r.json()),
  approveAccess: (data) => fetch(`${BASE}/approve_access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
  getAdminKey: (roiId) => fetch(`${BASE}/rois/${roiId}/admin_key`).then(r => r.json()),
  getEncryptedPatch: (roiId) => fetch(`${BASE}/rois/${roiId}/encrypted_patch`).then(r => r.arrayBuffer()),
  getAccess: (userId, roiId) => fetch(`${BASE}/access/${userId}/${roiId}`).then(r => r.ok ? r.json() : null),
  getUserPublicKey: (userId) => fetch(`${BASE}/users/${userId}/public_key`).then(r => r.json()),
  baseImageUrl: (path) => `${BASE}/uploads/base/${path.split(/[\\/]/).pop()}`,
};
