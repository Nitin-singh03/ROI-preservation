import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/api";
import ImageViewer from "../components/ImageViewer";

export default function UserDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [rois, setRois] = useState([]);
  const [reqStatus, setReqStatus] = useState({});
  const [accessMap, setAccessMap] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { api.listImages().then(setImages); }, []);

  const checkAccess = useCallback(async (roiList) => {
    const results = await Promise.all(
      roiList.map(roi => api.getAccess(user.user_id, roi.roi_id))
    );
    const map = {};
    const statuses = {};
    roiList.forEach((roi, i) => {
      if (results[i]) {
        map[roi.roi_id] = true;
        statuses[roi.roi_id] = "approved";
      }
    });
    setAccessMap(map);
    setReqStatus(prev => ({ ...prev, ...statuses }));
  }, [user.user_id]);

  const selectImage = async (img) => {
    setSelectedImage(img);
    setReqStatus({});
    setAccessMap({});
    const roiList = await api.listRois(img.image_id);
    setRois(roiList);
    await checkAccess(roiList);
  };

  const requestAccess = async (roi_id) => {
    setReqStatus(s => ({ ...s, [roi_id]: "requesting..." }));
    const res = await api.requestAccess({ user_id: user.user_id, roi_id });
    setReqStatus(s => ({ ...s, [roi_id]: res.status }));
  };

  const refreshAccess = async () => {
    if (!rois.length) return;
    setRefreshing(true);
    await checkAccess(rois);
    setRefreshing(false);
  };

  // Auto-poll approval status every 3 seconds when an image is selected
  useEffect(() => {
    if (!selectedImage || !rois.length) return;
    const interval = setInterval(() => {
      checkAccess(rois);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedImage, rois, checkAccess]);

  const approvedCount = Object.values(accessMap).filter(Boolean).length;

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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a1a2e" }}>ROI Viewer</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#9899a6" }}>
            Signed in as <span style={{ color: "#5c63dd", fontWeight: 600 }}>{user.username}</span>
          </p>
        </div>
        {selectedImage && (
          <button
            onClick={refreshAccess}
            disabled={refreshing}
            style={{
              background: "#f0f1ff", border: "1px solid #c7caff",
              color: "#5c63dd", padding: "8px 18px", borderRadius: 8,
              cursor: "pointer", fontSize: 13, fontWeight: 600
            }}
          >
            {refreshing ? "Checking..." : "↻ Check Approval"}
          </button>
        )}
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto" }}>
        {/* Image Gallery */}
        <div style={{ marginBottom: 36 }}>
          <h2 style={{ margin: "0 0 20px", fontSize: 13, fontWeight: 700, color: "#9899a6", textTransform: "uppercase", letterSpacing: 1 }}>
            Available Images
          </h2>
          {images.length === 0 ? (
            <div style={{
              background: "#fff", border: "1px dashed #dde0f0",
              borderRadius: 12, padding: 48, textAlign: "center", color: "#bbb"
            }}>
              No images uploaded yet.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
              {images.map(img => {
                const isSelected = selectedImage?.image_id === img.image_id;
                return (
                  <div
                    key={img.image_id}
                    onClick={() => selectImage(img)}
                    style={{
                      borderRadius: 12, overflow: "hidden", cursor: "pointer",
                      border: isSelected ? "2px solid #5c63dd" : "2px solid transparent",
                      background: "#fff",
                      boxShadow: isSelected
                        ? "0 0 0 3px rgba(92,99,221,0.15), 0 8px 24px rgba(0,0,0,0.1)"
                        : "0 2px 12px rgba(0,0,0,0.07)",
                      transition: "all 0.2s",
                      transform: isSelected ? "scale(1.02)" : "scale(1)"
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = isSelected ? "0 0 0 3px rgba(92,99,221,0.15), 0 8px 24px rgba(0,0,0,0.1)" : "0 2px 12px rgba(0,0,0,0.07)"; }}
                  >
                    <div style={{ position: "relative", paddingTop: "66%", background: "#f0f1f5" }}>
                      <img
                        src={api.baseImageUrl(img.base_path || img.image_id)}
                        alt={img.filename}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                        onError={e => { e.target.style.display = "none"; }}
                      />
                      {isSelected && (
                        <div style={{
                          position: "absolute", top: 8, right: 8,
                          background: "#5c63dd", borderRadius: "50%",
                          width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700, color: "#fff"
                        }}>✓</div>
                      )}
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {img.filename || img.image_id.slice(0, 12)}
                      </p>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: "#aaa" }}>
                        {img.roi_count != null ? `${img.roi_count} region${img.roi_count !== 1 ? "s" : ""}` : "Click to load"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Viewer */}
        {selectedImage && (
          <div style={{
            background: "#fff", borderRadius: 16,
            border: "1px solid #e8eaf0",
            overflow: "hidden",
            boxShadow: "0 4px 24px rgba(0,0,0,0.07)"
          }}>
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid #f0f1f5",
              display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>{selectedImage.filename}</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12, color: "#aaa" }}>
                  {rois.length} region{rois.length !== 1 ? "s" : ""} detected
                  {approvedCount > 0 && <span style={{ color: "#28a745", marginLeft: 8 }}>· {approvedCount} approved</span>}
                </p>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <ImageViewer
                image={selectedImage}
                rois={rois}
                user={user}
                accessMap={accessMap}
                reqStatus={reqStatus}
                onRequestAccess={requestAccess}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
