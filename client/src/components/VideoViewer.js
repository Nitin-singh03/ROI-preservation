/**
 * VideoViewer.js
 *
 * Main video ROI viewer — mirrors ImageViewer.js but for video with ML-KEM decryption.
 *
 * Props:
 *   video        - video record { video_id, filename, fps, width, height, total_frames }
 *   persons      - array of person records { person_id, track_id, frame_count }
 *   user         - logged-in user { user_id, username, role }
 *   videoAccessMap - { [track_id]: true } approved accesses
 *   reqStatus    - { [track_id]: "pending" | "requesting..." | "approved" }
 *   onRequestAccess - (track_id) => void
 */

import { useState, useCallback, useEffect } from "react";
import { api } from "../utils/api";
import { mlkemDecapsulate } from "../utils/mlkemUtils";
import VideoPlayerWithOverlay from "./VideoPlayerWithOverlay";

// ── AES-GCM decrypt (same layout as image pipeline: iv(12)+ciphertext+tag(16)) ──
async function aesGcmDecryptVideoFrame(aesKeyBytes, ivB64, ciphertextB64, tagB64) {
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(tagB64), c => c.charCodeAt(0));

  const key = await window.crypto.subtle.importKey(
    "raw", aesKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]
  );

  const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
  ciphertextWithTag.set(ciphertext);
  ciphertextWithTag.set(tag, ciphertext.length);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ciphertextWithTag
  );
  return new Uint8Array(decrypted);
}

// Decode raw BGR bytes (from OpenCV) → ImageBitmap
async function rawBgrToImageBitmap(rawBytes, width, height) {
  // OpenCV stores BGR; convert to RGBA for canvas
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = rawBytes[i * 3 + 2]; // R ← B channel
    rgba[i * 4 + 1] = rawBytes[i * 3 + 1]; // G
    rgba[i * 4 + 2] = rawBytes[i * 3 + 0]; // B ← R channel
    rgba[i * 4 + 3] = 255;
  }
  const imgData = new ImageData(rgba, width, height);
  return await createImageBitmap(imgData);
}

export default function VideoViewer({ video, persons, user, videoAccessMap, reqStatus, onRequestAccess }) {
  const [personStatus, setPersonStatus] = useState({}); // { [track_id]: "decrypting..." | "revealed ✓" | "Error: ..." }
  const [revealedPatches, setRevealedPatches] = useState(new Map()); // Map<frameIndex, ImageBitmap[]>
  const [frameRoiMap, setFrameRoiMap] = useState(new Map());         // Map<frameIndex, roiRecord[]>
  const [decryptingPerson, setDecryptingPerson] = useState(null);
  const [decryptProgress, setDecryptProgress] = useState(null);
  const [modal, setModal] = useState(null); // { person }

  const fps = video?.fps || 25;

  // Auto-decrypt any person that has been approved
  useEffect(() => {
    if (!persons || !videoAccessMap || !video) return;
    persons.forEach(person => {
      const tid = person.track_id;
      if (videoAccessMap[tid] && !personStatus[tid]) {
        decryptAndReveal(person);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons, videoAccessMap, video]);

  const decryptAndReveal = useCallback(async (person) => {
    const tid = person.track_id;
    setPersonStatus(s => ({ ...s, [tid]: "decrypting..." }));
    setDecryptingPerson(tid);
    try {
      // 1. Get the user's personal ML-KEM ciphertext (admin re-encapsulated for this user)
      const accessData = await api.getVideoAccess(user.user_id, video.video_id, tid);
      if (!accessData) throw new Error("No approved access found");

      // 2. Parse the re-encapsulated payload: { ct: mlkemCiphertextB64, xk: xoredAesKeyB64 }
      let aesKeyBytes;
      try {
        const payload = JSON.parse(accessData.user_kem_ciphertext);
        const { ct, xk } = payload;

        // ML-KEM decapsulate user's ciphertext → shared secret
        const sharedSecret = await mlkemDecapsulate(user.username, ct);

        // Recover AES key: aesKey = sharedSecret XOR xoredKey
        const xoredKey = Uint8Array.from(atob(xk), c => c.charCodeAt(0));
        aesKeyBytes = new Uint8Array(xoredKey.length);
        for (let i = 0; i < xoredKey.length; i++) {
          aesKeyBytes[i] = xoredKey[i] ^ sharedSecret[i % sharedSecret.length];
        }
      } catch (parseErr) {
        // Fallback: treat as plain ciphertext for forward compatibility
        aesKeyBytes = await mlkemDecapsulate(user.username, accessData.user_kem_ciphertext);
      }


      // 3. Fetch per-frame ROI metadata for this person
      const roiRecords = await api.getPersonMetadata(video.video_id, tid);
      const total = roiRecords.length;

      // Group metadata by frame_index
      const newFrameRoiMap = new Map(frameRoiMap);
      const newRevealedPatches = new Map(revealedPatches);

      setDecryptProgress({ done: 0, total });

      // 4. Decrypt each frame ROI patch
      for (let i = 0; i < roiRecords.length; i++) {
        const record = roiRecords[i];
        const { frame_index, bbox, patch_shape, iv, ciphertext, tag } = record;
        const [patchH, patchW] = patch_shape;

        try {
          const rawBytes = await aesGcmDecryptVideoFrame(aesKeyBytes, iv, ciphertext, tag);
          const bitmap = await rawBgrToImageBitmap(rawBytes, patchW, patchH);

          // Store bitmap keyed by frame_index
          if (!newRevealedPatches.has(frame_index)) {
            newRevealedPatches.set(frame_index, []);
          }
          newRevealedPatches.get(frame_index).push(bitmap);

          // Store ROI record for overlay positioning
          if (!newFrameRoiMap.has(frame_index)) {
            newFrameRoiMap.set(frame_index, []);
          }
          newFrameRoiMap.get(frame_index).push({ bbox });

        } catch (patchErr) {
          // Individual patch failures don't abort the whole decryption
          console.warn(`[VideoViewer] Frame ${frame_index} patch failed:`, patchErr.message);
        }

        // Update progress every 50 frames to avoid excessive re-renders
        if (i % 50 === 0 || i === roiRecords.length - 1) {
          setDecryptProgress({ done: i + 1, total });
          // Yield to browser to update UI
          await new Promise(r => setTimeout(r, 0));
        }
      }

      setRevealedPatches(new Map(newRevealedPatches));
      setFrameRoiMap(new Map(newFrameRoiMap));
      setPersonStatus(s => ({ ...s, [tid]: "revealed ✓" }));

    } catch (err) {
      console.error("[VideoViewer] Decrypt error:", err);
      setPersonStatus(s => ({ ...s, [tid]: `Error: ${err.message}` }));
    } finally {
      setDecryptingPerson(null);
      setDecryptProgress(null);
    }
  }, [user, video, frameRoiMap, revealedPatches]);

  if (!video) return null;

  const videoUrl = api.maskedVideoUrl(video.video_id);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* Left: Video Player */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <VideoPlayerWithOverlay
          videoUrl={videoUrl}
          revealedPatches={revealedPatches}
          frameRoiMap={frameRoiMap}
          fps={fps}
          decryptingPerson={decryptingPerson}
          decryptProgress={decryptProgress}
        />
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
            Select a person from the panel to request or decrypt their face region.
          </p>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 11, color: "#6366f1", fontWeight: 600,
            background: "#eef2ff", border: "1px solid #c7d2fe",
            padding: "4px 10px", borderRadius: 6,
          }}>
            🔐 ML-KEM-768 Protected
          </div>
        </div>
      </div>

      {/* Right: Person cards panel */}
      <div style={{
        width: 220, flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <p style={{
          margin: "0 0 4px",
          fontSize: 11, fontWeight: 700, color: "#9899a6",
          textTransform: "uppercase", letterSpacing: 1,
        }}>
          Persons Detected ({persons.length})
        </p>

        {persons.length === 0 && (
          <div style={{
            background: "#f5f6fa", border: "1px dashed #dde0f0",
            borderRadius: 10, padding: "18px 14px", textAlign: "center",
            color: "#bbb", fontSize: 13,
          }}>
            No persons detected
          </div>
        )}

        {persons.map(person => {
          const tid = person.track_id;
          const status = personStatus[tid];
          const isApproved = !!videoAccessMap?.[tid];
          const isRevealed = status === "revealed ✓";
          const isPending = reqStatus?.[tid] === "pending" || reqStatus?.[tid] === "requesting...";
          const isDecrypting = status === "decrypting...";
          const hasError = status?.startsWith("Error:");

          let borderColor = "#e8eaf0";
          let bgColor = "#fff";
          let badgeBg = "#f0f1f5";
          let badgeColor = "#888";
          let badgeText = "🔒 No Access";

          if (isRevealed) {
            borderColor = "#a7f3d0";
            bgColor = "#f0fdf4";
            badgeBg = "#dcfce7";
            badgeColor = "#166534";
            badgeText = "✓ Revealed";
          } else if (isDecrypting) {
            borderColor = "#a5b4fc";
            bgColor = "#eef2ff";
            badgeBg = "#e0e7ff";
            badgeColor = "#4338ca";
            badgeText = "⚙ Decrypting...";
          } else if (hasError) {
            borderColor = "#fca5a5";
            bgColor = "#fef2f2";
            badgeBg = "#fee2e2";
            badgeColor = "#991b1b";
            badgeText = "⚠ Error";
          } else if (isApproved) {
            borderColor = "#6ee7b7";
            bgColor = "#f0fdf4";
            badgeBg = "#d1fae5";
            badgeColor = "#065f46";
            badgeText = "✓ Approved";
          } else if (isPending) {
            borderColor = "#fde68a";
            bgColor = "#fffbeb";
            badgeBg = "#fef3c7";
            badgeColor = "#92400e";
            badgeText = "⏳ Pending";
          }

          return (
            <div
              key={tid}
              onClick={() => !isDecrypting && setModal({ person })}
              style={{
                background: bgColor,
                border: `1.5px solid ${borderColor}`,
                borderRadius: 12,
                padding: "12px 14px",
                cursor: isDecrypting ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
              }}
              onMouseEnter={e => { if (!isDecrypting) e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.1)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 6px rgba(0,0,0,0.05)"; }}
            >
              {/* Person avatar */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: isRevealed
                    ? "linear-gradient(135deg, #34d399, #10b981)"
                    : "linear-gradient(135deg, #818cf8, #6366f1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, flexShrink: 0,
                  boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                }}>
                  {isRevealed ? "🔓" : "👤"}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>
                    Person {tid}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: "#aaa" }}>
                    {person.frame_count} frames
                  </p>
                </div>
              </div>

              {/* Status badge */}
              <div style={{
                display: "inline-flex", alignItems: "center",
                background: badgeBg, color: badgeColor,
                fontSize: 10, fontWeight: 700,
                padding: "3px 8px", borderRadius: 20,
              }}>
                {badgeText}
              </div>

              {/* Error message */}
              {hasError && (
                <p style={{ margin: "6px 0 0", fontSize: 10, color: "#dc2626", wordBreak: "break-word" }}>
                  {status}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modal && (() => {
        const { person } = modal;
        const tid = person.track_id;
        const status = personStatus[tid];
        const isApproved = !!videoAccessMap?.[tid];
        const isRevealed = status === "revealed ✓";
        const isPending = reqStatus?.[tid] === "pending" || reqStatus?.[tid] === "requesting...";
        const hasError = status?.startsWith("Error:");

        return (
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, backdropFilter: "blur(4px)",
          }}
            onClick={() => setModal(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "#fff", borderRadius: 16, padding: 28,
                maxWidth: 400, width: "90%",
                boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
                border: "1px solid #e8eaf0",
                animation: "slideUp 0.25s ease",
              }}
            >
              <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}`}</style>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "linear-gradient(135deg, #818cf8, #6366f1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, boxShadow: "0 4px 12px rgba(99,102,241,0.3)",
                }}>👤</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: "#1a1a2e" }}>
                    Person {tid}
                  </h3>
                  <p style={{ margin: 0, fontSize: 12, color: "#aaa" }}>
                    {person.frame_count} frames detected
                  </p>
                </div>
              </div>

              {/* ML-KEM badge */}
              <div style={{
                background: "#eef2ff", border: "1px solid #c7d2fe",
                borderRadius: 8, padding: "8px 12px", marginBottom: 18,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 16 }}>🛡️</span>
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#4338ca" }}>ML-KEM-768 Encrypted</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#6366f1" }}>Post-quantum key encapsulation</p>
                </div>
              </div>

              {/* Content by state */}
              {isRevealed ? (
                <>
                  <p style={{ color: "#16a34a", fontWeight: 600, fontSize: 14, margin: "0 0 16px" }}>
                    ✓ Face region already revealed in player.
                  </p>
                  <button onClick={() => setModal(null)} style={btnStyle("#f0f1f5", "#666")}>
                    Close
                  </button>
                </>
              ) : isApproved ? (
                <>
                  <p style={{ fontSize: 13, color: "#555", margin: "0 0 10px" }}>
                    You have access to this person's face region.
                  </p>
                  {hasError && (
                    <p style={{ color: "#dc2626", fontSize: 12, margin: "0 0 12px" }}>{status}</p>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => { decryptAndReveal(person); setModal(null); }}
                      style={btnStyle("#4f46e5", "#fff")}
                    >
                      🔓 Decrypt &amp; Reveal
                    </button>
                    <button onClick={() => setModal(null)} style={btnStyle("#f0f1f5", "#666")}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    background: isPending ? "#fffbeb" : "#f4f5ff",
                    border: `1px solid ${isPending ? "#fde68a" : "#c7caff"}`,
                    borderRadius: 8, padding: "10px 14px", marginBottom: 16,
                  }}>
                    <p style={{ margin: 0, fontSize: 13, color: isPending ? "#92400e" : "#4338ca" }}>
                      {isPending
                        ? "⏳ Access request pending admin approval."
                        : "🔒 You don't have access to this region yet."}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!isPending && (
                      <button
                        onClick={() => { onRequestAccess(tid); setModal(null); }}
                        style={btnStyle("#4f46e5", "#fff")}
                      >
                        Request Access
                      </button>
                    )}
                    <button onClick={() => setModal(null)} style={btnStyle("#f0f1f5", "#666")}>
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function btnStyle(bg, color) {
  return {
    background: bg, color,
    border: "none", padding: "9px 18px",
    borderRadius: 8, cursor: "pointer",
    fontWeight: 600, fontSize: 13,
    fontFamily: "inherit",
  };
}
