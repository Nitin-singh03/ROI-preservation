import { useEffect, useState, useCallback } from "react";
import { api } from "../utils/api";
import ImageViewer from "../components/ImageViewer";
import VideoViewer from "../components/VideoViewer";

export default function UserDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("images"); // "images" | "videos"

  // ── Image state ───────────────────────────────────────────────────────────
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [rois, setRois] = useState([]);
  const [reqStatus, setReqStatus] = useState({});
  const [accessMap, setAccessMap] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  // ── Video state ───────────────────────────────────────────────────────────
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [persons, setPersons] = useState([]);
  const [videoReqStatus, setVideoReqStatus] = useState({});
  const [videoAccessMap, setVideoAccessMap] = useState({});
  const [videoRefreshing, setVideoRefreshing] = useState(false);

  useEffect(() => {
    api.listImages().then(setImages);
    api.listVideos().then(setVideos);
  }, []);

  // ── Image helpers ─────────────────────────────────────────────────────────
  const checkAccess = useCallback(async (roiList) => {
    try {
      const results = await Promise.all(roiList.map(roi => api.getAccess(user.user_id, roi.roi_id)));
      const map = {}, statuses = {};
      roiList.forEach((roi, i) => {
        if (results[i]) { map[roi.roi_id] = true; statuses[roi.roi_id] = "approved"; }
      });
      setAccessMap(map);
      setReqStatus(prev => ({ ...prev, ...statuses }));
    } catch (err) {
      console.warn("checkAccess error:", err);
    }
  }, [user.user_id]);

  const selectImage = async (img) => {
    setSelectedImage(img);
    setReqStatus({}); setAccessMap({});
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

  useEffect(() => {
    if (!selectedImage || !rois.length) return;
    const interval = setInterval(() => checkAccess(rois), 3000);
    return () => clearInterval(interval);
  }, [selectedImage, rois, checkAccess]);

  // ── Video helpers ─────────────────────────────────────────────────────────
  const checkVideoAccess = useCallback(async (personList, videoId) => {
    try {
      const results = await Promise.all(
        personList.map(p => api.getVideoAccess(user.user_id, videoId, p.track_id))
      );
      const map = {}, statuses = {};
      personList.forEach((p, i) => {
        if (results[i]) { map[p.track_id] = true; statuses[p.track_id] = "approved"; }
      });
      setVideoAccessMap(map);
      setVideoReqStatus(prev => ({ ...prev, ...statuses }));
    } catch (err) {
      console.warn("checkVideoAccess error:", err);
    }
  }, [user.user_id]);

  const selectVideo = async (vid) => {
    setSelectedVideo(vid);
    setVideoReqStatus({}); setVideoAccessMap({});
    const personList = await api.listPersons(vid.video_id);
    setPersons(personList);
    await checkVideoAccess(personList, vid.video_id);
  };

  const requestVideoAccess = async (track_id) => {
    setVideoReqStatus(s => ({ ...s, [track_id]: "requesting..." }));
    const res = await api.requestVideoAccess({ user_id: user.user_id, video_id: selectedVideo.video_id, track_id });
    setVideoReqStatus(s => ({ ...s, [track_id]: res.status }));
  };

  const refreshVideoAccess = async () => {
    if (!persons.length || !selectedVideo) return;
    setVideoRefreshing(true);
    await checkVideoAccess(persons, selectedVideo.video_id);
    setVideoRefreshing(false);
  };

  useEffect(() => {
    if (!selectedVideo || !persons.length) return;
    const interval = setInterval(() => checkVideoAccess(persons, selectedVideo.video_id), 3000);
    return () => clearInterval(interval);
  }, [selectedVideo, persons, checkVideoAccess]);

  const approvedImgCount = Object.values(accessMap).filter(Boolean).length;
  const approvedVidCount = Object.values(videoAccessMap).filter(Boolean).length;

  // ── Shared styles ─────────────────────────────────────────────────────────
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
      <div style={{
        background: "#fff", borderBottom: "1px solid #e8eaf0",
        padding: "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1a1a2e" }}>ROI Viewer</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#9899a6" }}>
            Signed in as <span style={{ color: "#5c63dd", fontWeight: 600 }}>{user.username}</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {activeTab === "images" && selectedImage && (
            <button onClick={refreshAccess} disabled={refreshing}
              style={{ background: "#f0f1ff", border: "1px solid #c7caff", color: "#5c63dd", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {refreshing ? "Checking..." : "↻ Check Approval"}
            </button>
          )}
          {activeTab === "videos" && selectedVideo && (
            <button onClick={refreshVideoAccess} disabled={videoRefreshing}
              style={{ background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4f46e5", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {videoRefreshing ? "Checking..." : "↻ Check Approval"}
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1300, margin: "0 auto" }}>
        {/* Tab switcher */}
        <div style={{
          display: "inline-flex", gap: 4, background: "#f1f5f9",
          border: "1px solid #e2e8f0", borderRadius: 10, padding: 4, marginBottom: 28,
        }}>
          <button style={tabBtn("images")} onClick={() => setActiveTab("images")}>
            🖼️ Images
          </button>
          <button style={tabBtn("videos")} onClick={() => setActiveTab("videos")}>
            🎬 Videos
            {activeTab === "videos" && approvedVidCount > 0 && (
              <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "1px 6px", fontSize: 11 }}>
                {approvedVidCount}
              </span>
            )}
          </button>
        </div>

        {/* ═══ IMAGES TAB ═══════════════════════════════════════════════════ */}
        {activeTab === "images" && (
          <>
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 13, fontWeight: 700, color: "#9899a6", textTransform: "uppercase", letterSpacing: 1 }}>
                Available Images
              </h2>
              {images.length === 0 ? (
                <div style={{ background: "#fff", border: "1px dashed #dde0f0", borderRadius: 12, padding: 48, textAlign: "center", color: "#bbb" }}>
                  No images uploaded yet.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                  {images.map(img => {
                    const isSelected = selectedImage?.image_id === img.image_id;
                    return (
                      <div key={img.image_id} onClick={() => selectImage(img)} style={{
                        borderRadius: 12, overflow: "hidden", cursor: "pointer",
                        border: isSelected ? "2px solid #5c63dd" : "2px solid transparent",
                        background: "#fff",
                        boxShadow: isSelected ? "0 0 0 3px rgba(92,99,221,0.15), 0 8px 24px rgba(0,0,0,0.1)" : "0 2px 12px rgba(0,0,0,0.07)",
                        transition: "all 0.2s", transform: isSelected ? "scale(1.02)" : "scale(1)",
                      }}
                        onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)"; } }}
                        onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.07)"; } }}
                      >
                        <div style={{ position: "relative", paddingTop: "66%", background: "#f0f1f5" }}>
                          <img src={api.baseImageUrl(img.base_path || img.image_id)} alt={img.filename}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                            onError={e => { e.target.style.display = "none"; }} />
                          {isSelected && (
                            <div style={{ position: "absolute", top: 8, right: 8, background: "#5c63dd", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>✓</div>
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

            {selectedImage && (
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>{selectedImage.filename}</h3>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "#aaa" }}>
                      {rois.length} region{rois.length !== 1 ? "s" : ""} detected
                      {approvedImgCount > 0 && <span style={{ color: "#28a745", marginLeft: 8 }}>· {approvedImgCount} approved</span>}
                    </p>
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <ImageViewer image={selectedImage} rois={rois} user={user} accessMap={accessMap} reqStatus={reqStatus} onRequestAccess={requestAccess} />
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ VIDEOS TAB ═══════════════════════════════════════════════════ */}
        {activeTab === "videos" && (
          <>
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 13, fontWeight: 700, color: "#9899a6", textTransform: "uppercase", letterSpacing: 1 }}>
                Available Videos
              </h2>
              {videos.length === 0 ? (
                <div style={{ background: "#fff", border: "1px dashed #dde0f0", borderRadius: 12, padding: 48, textAlign: "center", color: "#bbb" }}>
                  No videos uploaded yet.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                  {videos.map(vid => {
                    const isSelected = selectedVideo?.video_id === vid.video_id;
                    return (
                      <div key={vid.video_id} onClick={() => selectVideo(vid)} style={{
                        borderRadius: 12, overflow: "hidden", cursor: "pointer",
                        border: isSelected ? "2px solid #6366f1" : "2px solid transparent",
                        background: "#fff",
                        boxShadow: isSelected ? "0 0 0 3px rgba(99,102,241,0.15), 0 8px 24px rgba(0,0,0,0.1)" : "0 2px 12px rgba(0,0,0,0.07)",
                        transition: "all 0.2s", transform: isSelected ? "scale(1.02)" : "scale(1)",
                      }}
                        onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.transform = "scale(1.03)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)"; } }}
                        onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.07)"; } }}
                      >
                        {/* Video thumbnail placeholder */}
                        <div style={{ position: "relative", paddingTop: "56%", background: "linear-gradient(135deg, #1e1b4b, #312e81)" }}>
                          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 28 }}>🎬</div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>ENCRYPTED VIDEO</div>
                          </div>
                          {/* ML-KEM badge */}
                          <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(99,102,241,0.85)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, backdropFilter: "blur(4px)" }}>
                            ML-KEM-768
                          </div>
                          {/* Person count badge */}
                          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>
                            {vid.person_count || 0} persons
                          </div>
                          {isSelected && (
                            <div style={{ position: "absolute", bottom: 8, right: 8, background: "#6366f1", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>✓</div>
                          )}
                        </div>
                        <div style={{ padding: "10px 12px" }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {vid.filename || vid.video_id.slice(0, 12)}
                          </p>
                          <p style={{ margin: "3px 0 0", fontSize: 11, color: "#aaa" }}>
                            {vid.total_frames ? `${vid.total_frames} frames · ` : ""}{vid.fps || 25} fps
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedVideo && (
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e8eaf0", overflow: "hidden", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f1f5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, color: "#1a1a2e" }}>{selectedVideo.filename}</h3>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "#aaa" }}>
                      {persons.length} person{persons.length !== 1 ? "s" : ""} detected
                      {approvedVidCount > 0 && <span style={{ color: "#28a745", marginLeft: 8 }}>· {approvedVidCount} approved</span>}
                      &nbsp;·&nbsp;
                      <span style={{ color: "#6366f1", fontWeight: 600 }}>🔐 ML-KEM-768</span>
                    </p>
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <VideoViewer
                    video={selectedVideo}
                    persons={persons}
                    user={user}
                    videoAccessMap={videoAccessMap}
                    reqStatus={videoReqStatus}
                    onRequestAccess={requestVideoAccess}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
