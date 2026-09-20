import { useEffect, useRef, useState } from "react";
import { api } from "../utils/api";
import { aesGcmDecrypt } from "../utils/cryptoUtils";

export default function ImageViewer({ image, rois, user, accessMap, reqStatus, onRequestAccess }) {
  const canvasRef = useRef(null);
  const [decryptStatus, setDecryptStatus] = useState({});
  const [imageLoaded, setImageLoaded] = useState(false);
  const [modal, setModal] = useState(null); // { roi } | null

  useEffect(() => {
    if (!image) return;
    setImageLoaded(false);
    setDecryptStatus({});
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = api.baseImageUrl(image.base_path);
    img.onload = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        setImageLoaded(true);
      }
    };
  }, [image]);

  const decryptAndReveal = async (roi) => {
    setDecryptStatus(s => ({ ...s, [roi.roi_id]: "decrypting..." }));
    try {
      const access = await api.getAccess(user.user_id, roi.roi_id);
      if (!access) throw new Error("No approved access found");

      const privateKeyB64 = localStorage.getItem(`${user.username}_private_b64`);
      if (!privateKeyB64) throw new Error("Private key not found in this browser");

      const pkcs8 = Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0));
      const privateKey = await window.crypto.subtle.importKey(
        "pkcs8", pkcs8,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, ["decrypt"]
      );
      const encryptedBytes = new Uint8Array(
        access.user_encrypted_aes_key.match(/.{1,2}/g).map(b => parseInt(b, 16))
      );
      const aesKeyBytes = new Uint8Array(
        await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedBytes)
      );

      const encryptedBuffer = await api.getEncryptedPatch(roi.roi_id);
      const decryptedBytes = await aesGcmDecrypt(aesKeyBytes, new Uint8Array(encryptedBuffer));

      const blob = new Blob([decryptedBytes], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const roiImg = new Image();
      roiImg.onload = () => {
        if (canvasRef.current) {
          canvasRef.current.getContext("2d").drawImage(roiImg, roi.x, roi.y, roi.w, roi.h);
        }
        URL.revokeObjectURL(url);
        setDecryptStatus(s => ({ ...s, [roi.roi_id]: "revealed ✓" }));
      };
      roiImg.src = url;
    } catch (err) {
      setDecryptStatus(s => ({ ...s, [roi.roi_id]: `Error: ${err.message}` }));
    }
  };

  // Automatically decrypt any ROI once access is approved
  useEffect(() => {
    if (!imageLoaded || !rois || !accessMap) return;
    rois.forEach(roi => {
      if (accessMap[roi.roi_id] && !decryptStatus[roi.roi_id]) {
        decryptAndReveal(roi);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageLoaded, rois, accessMap, decryptStatus]);

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const clicked = rois.find(roi =>
      x >= roi.x && x <= roi.x + roi.w && y >= roi.y && y <= roi.y + roi.h
    );
    if (!clicked) return;

    setModal({ roi: clicked });
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${image?.filename || "image"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const roiStatus = modal ? decryptStatus[modal.roi.roi_id] : null;
  const isApproved = modal && accessMap?.[modal.roi.roi_id];
  const isPending = modal && (reqStatus?.[modal.roi.roi_id] === "pending" || reqStatus?.[modal.roi.roi_id] === "requesting...");

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ maxWidth: "100%", borderRadius: 8, display: "block", cursor: "crosshair", background: "#f0f1f5" }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <p style={{ fontSize: 12, color: "#bbb", margin: 0 }}>
          Click on a masked (black) region to request access or decrypt it.
        </p>
        <button
          onClick={downloadCanvas}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#f0f1ff", border: "1px solid #c7d2fe",
            color: "#4f46e5", padding: "7px 14px", borderRadius: 8,
            cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            transition: "all 0.2s", flexShrink: 0,
          }}
          onMouseOver={e => { e.currentTarget.style.background = "#eef2ff"; e.currentTarget.style.borderColor = "#818cf8"; }}
          onMouseOut={e => { e.currentTarget.style.background = "#f0f1ff"; e.currentTarget.style.borderColor = "#c7d2fe"; }}
          title="Download current view (masked or with revealed regions)"
        >
          ⬇ Download Image
        </button>
      </div>

      {modal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
        }}>
          <div style={{
            background: "#fff", borderRadius: 14, padding: 24,
            maxWidth: 400, width: "90%",
            border: "1px solid #e8eaf0",
            boxShadow: "0 16px 48px rgba(0,0,0,0.15)"
          }}>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#1a1a2e" }}>
                Region <span style={{ color: "#5c63dd", fontFamily: "monospace" }}>{modal.roi.roi_id.slice(0, 8)}</span>
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: "#bbb", fontFamily: "monospace" }}>
                x={modal.roi.x} y={modal.roi.y} w={modal.roi.w} h={modal.roi.h}
              </p>
            </div>

            {roiStatus === "revealed ✓" ? (
              <>
                <p style={{ color: "#28a745", fontWeight: 600, fontSize: 14 }}>✓ Already revealed on image.</p>
                <button onClick={() => setModal(null)} style={{
                  background: "#f0f1f5", color: "#666", border: "none",
                  padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13
                }}>Close</button>
              </>
            ) : isApproved ? (
              <>
                <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
                  You have access to this region.
                </p>
                {roiStatus && roiStatus.startsWith("Error") && (
                  <p style={{ color: "#e05c63", fontSize: 12, margin: "0 0 12px" }}>{roiStatus}</p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => decryptAndReveal(modal.roi)}
                    style={{
                      background: "#28a745", color: "#fff",
                      border: "none", padding: "9px 18px", borderRadius: 8,
                      cursor: "pointer", fontWeight: 600, fontSize: 13
                    }}
                  >
                    Decrypt & Reveal
                  </button>
                  <button onClick={() => setModal(null)} style={{
                    background: "#f0f1f5", color: "#666", border: "none",
                    padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13
                  }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: isPending ? "#fffbea" : "#f4f5ff",
                  border: `1px solid ${isPending ? "#f5e080" : "#c7caff"}`,
                  borderRadius: 8, padding: "10px 14px", marginBottom: 16
                }}>
                  <p style={{ margin: 0, fontSize: 13, color: isPending ? "#9a7c00" : "#5c63dd" }}>
                    {isPending
                      ? "⏳ Access request pending admin approval."
                      : "🔒 You don't have access to this region yet."}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!isPending && (
                    <button
                      onClick={() => { onRequestAccess(modal.roi.roi_id); setModal(null); }}
                      style={{
                        background: "#5c63dd", color: "#fff",
                        border: "none", padding: "9px 18px", borderRadius: 8,
                        cursor: "pointer", fontWeight: 600, fontSize: 13
                      }}
                    >
                      Request Access
                    </button>
                  )}
                  <button onClick={() => setModal(null)} style={{
                    background: "#f0f1f5", color: "#666", border: "none",
                    padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13
                  }}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
