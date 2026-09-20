import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

const PHASES = [
  {
    num: "01",
    title: "Signup & Key Generation",
    emoji: "🔑",
    accent: "#4f46e5",
    bg: "#eef2ff",
    border: "#c7d2fe",
    tag: "Client-side crypto",
    steps: [
      "Browser generates an RSA-2048 key pair using the Web Crypto API",
      "Private key stored securely in your localStorage & IndexedDB",
      "Public key sent to server and saved in the database",
    ],
    tech: ["Web Crypto API", "RSA-2048", "IndexedDB"],
  },
  {
    num: "02",
    title: "Admin Uploads & ROI Detection",
    emoji: "🖼️",
    accent: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    tag: "AI + Encryption",
    steps: [
      "Admin uploads an image — YOLOv8 detects ROIs (faces, objects)",
      "Each ROI crop is encrypted with a fresh AES-256-GCM key",
      "That AES key is RSA-encrypted with admin's public key and saved",
      "Encrypted crop stored as a .bin file; original image blacked-out",
    ],
    tech: ["YOLOv8", "AES-256-GCM", "RSA-OAEP", "FastAPI"],
  },
  {
    num: "03",
    title: "User Requests Access",
    emoji: "🙋",
    accent: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
    tag: "Access Control",
    steps: [
      "User views the image — sensitive regions appear blacked out",
      "User clicks 'Request Access' on any blacked-out ROI",
      "A pending access request is recorded in the database",
    ],
    tech: ["React", "REST API", "JWT Auth"],
  },
  {
    num: "04",
    title: "Admin Approves & Re-encrypts",
    emoji: "✅",
    accent: "#db2777",
    bg: "#fdf2f8",
    border: "#fbcfe8",
    tag: "Key Delegation",
    steps: [
      "Admin fetches the admin-encrypted AES key from the server",
      "Admin's browser decrypts it using their private RSA key",
      "Fetches the requesting user's public RSA key from the server",
      "Re-encrypts the AES key with the user's public key and uploads it",
    ],
    tech: ["Web Crypto API", "RSA-OAEP", "Zero-trust"],
  },
  {
    num: "05",
    title: "User Decrypts & Views ROI",
    emoji: "👁️",
    accent: "#0284c7",
    bg: "#f0f9ff",
    border: "#bae6fd",
    tag: "Browser Decryption",
    steps: [
      "User fetches their personal encrypted AES key from the server",
      "Their browser decrypts it using their stored private RSA key",
      "The encrypted .bin ROI patch is downloaded and decrypted in-browser",
      "Decrypted ROI is rendered as a smooth animated overlay on the image",
    ],
    tech: ["AES-256-GCM", "Web Crypto API", "Canvas API"],
  },
];

function PhaseCard({ phase, index }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.55s ease ${index * 0.1}s, transform 0.55s ease ${index * 0.1}s`,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderLeft: `4px solid ${phase.accent}`,
        borderRadius: 16,
        padding: "24px 24px 20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        display: "flex", flexDirection: "column", gap: 0,
        flex: "1 1 320px", minWidth: 290, maxWidth: 460,
      }}
    >
      {/* header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: phase.bg, border: `1px solid ${phase.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}>
          {phase.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: phase.accent,
              background: phase.bg, border: `1px solid ${phase.border}`,
              padding: "2px 8px", borderRadius: 20, letterSpacing: 0.5,
            }}>
              Phase {phase.num}
            </span>
            <span style={{
              fontSize: 10, color: "#94a3b8", fontWeight: 600,
              letterSpacing: 0.5, textTransform: "uppercase",
            }}>
              {phase.tag}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", lineHeight: 1.3 }}>
            {phase.title}
          </div>
        </div>
      </div>

      {/* steps */}
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {phase.steps.map((s, i) => (
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: phase.bg, border: `1px solid ${phase.border}`,
              color: phase.accent, fontSize: 10, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, marginTop: 1,
            }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.6 }}>{s}</span>
          </li>
        ))}
      </ul>

      {/* tech badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto" }}>
        {phase.tech.map((t) => (
          <span key={t} style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 20,
            background: phase.bg, border: `1px solid ${phase.border}`,
            color: phase.accent, fontWeight: 600,
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f8fafc",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      color: "#1e293b",
      overflowX: "hidden",
    }}>
      <style>{`
        @keyframes fadeInDown { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInUp   { from{opacity:0;transform:translateY(20px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes float      { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes pulse-dot  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes shimmer-bar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .nav-btn-outline {
          background: #fff; color: #4f46e5;
          border: 1.5px solid #c7d2fe;
          padding: 8px 20px; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; font-family: inherit;
        }
        .nav-btn-outline:hover { background: #eef2ff; border-color: #818cf8; }
        .nav-btn-fill {
          background: #4f46e5; color: #fff; border: none;
          padding: 8px 20px; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; font-family: inherit;
          box-shadow: 0 2px 8px rgba(79,70,229,0.3);
        }
        .nav-btn-fill:hover { background: #4338ca; box-shadow: 0 4px 16px rgba(79,70,229,0.4); transform: translateY(-1px); }
        .hero-btn-fill {
          background: #4f46e5; color: #fff; border: none;
          padding: 13px 32px; border-radius: 10px;
          font-size: 15px; font-weight: 700; cursor: pointer;
          transition: all 0.25s; font-family: inherit;
          box-shadow: 0 4px 16px rgba(79,70,229,0.35);
        }
        .hero-btn-fill:hover { background: #4338ca; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(79,70,229,0.45); }
        .hero-btn-ghost {
          background: #fff; color: #475569;
          border: 1.5px solid #e2e8f0;
          padding: 13px 32px; border-radius: 10px;
          font-size: 15px; font-weight: 600; cursor: pointer;
          transition: all 0.25s; font-family: inherit;
        }
        .hero-btn-ghost:hover { border-color: #94a3b8; color: #1e293b; transform: translateY(-1px); }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        height: 60, padding: "0 40px",
        display: "flex", alignItems: "center",
        background: scrolled ? "rgba(255,255,255,0.95)" : "#fff",
        borderBottom: "1px solid #e2e8f0",
        boxShadow: scrolled ? "0 2px 16px rgba(0,0,0,0.07)" : "none",
        backdropFilter: "blur(12px)",
        transition: "box-shadow 0.25s",
        animation: "fadeInDown 0.4s ease both",
      }}>
        {/* logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: "linear-gradient(135deg,#4f46e5,#818cf8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 17, boxShadow: "0 2px 8px rgba(79,70,229,0.3)",
          }}>🔐</div>
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1e293b" }}>
            ROI<span style={{ color: "#4f46e5" }}>Vault</span>
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="nav-btn-outline" onClick={() => navigate("/auth?mode=login")}>
            Login
          </button>
          <button className="nav-btn-fill" onClick={() => navigate("/auth?mode=signup")}>
            Sign Up
          </button>
        </div>
      </header>

      {/* ── HERO ── */}
      <section style={{
        paddingTop: 120, paddingBottom: 72,
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center", padding: "120px 24px 80px",
        background: "linear-gradient(180deg, #fff 0%, #f8fafc 100%)",
        borderBottom: "1px solid #e2e8f0",
      }}>
        {/* live badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          background: "#f0fdf4", border: "1px solid #bbf7d0",
          borderRadius: 100, padding: "5px 14px", marginBottom: 28,
          animation: "fadeInDown 0.5s ease 0.1s both",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "#22c55e", animation: "pulse-dot 1.8s infinite",
            display: "inline-block",
          }} />
          <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600, letterSpacing: 0.3 }}>
            End-to-End Encrypted · Zero Trust · Browser-side Crypto
          </span>
        </div>

        <h1 style={{
          fontSize: "clamp(32px, 6vw, 64px)", fontWeight: 900,
          lineHeight: 1.1, margin: "0 0 20px", color: "#0f172a",
          animation: "fadeInDown 0.6s ease 0.15s both",
        }}>
          Preserve Privacy in<br />
          <span style={{
            background: "linear-gradient(90deg,#4f46e5,#0284c7)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Sensitive Images
          </span>
        </h1>

        <p style={{
          fontSize: "clamp(15px, 1.8vw, 18px)", color: "#64748b",
          maxWidth: 560, lineHeight: 1.75, margin: "0 auto 36px",
          animation: "fadeInUp 0.6s ease 0.25s both",
        }}>
          Upload images, let AI detect sensitive regions, and control who sees what —
          with cryptography that runs entirely in the browser. The server never sees
          unencrypted data.
        </p>

        <div style={{
          display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center",
          animation: "fadeInUp 0.6s ease 0.35s both", marginBottom: 60,
        }}>
          <button className="hero-btn-fill" onClick={() => navigate("/auth?mode=signup")}>
            Get Started Free
          </button>
          <button className="hero-btn-ghost" onClick={() => {
            document.getElementById("how-it-works").scrollIntoView({ behavior: "smooth" });
          }}>
            How It Works ↓
          </button>
        </div>

        {/* stat cards */}
        <div style={{
          display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center",
          animation: "fadeInUp 0.6s ease 0.45s both",
        }}>
          {[
            { icon: "🔑", val: "RSA-2048", label: "Asymmetric keys" },
            { icon: "🔒", val: "AES-256-GCM", label: "Symmetric cipher" },
            { icon: "🤖", val: "YOLOv8", label: "ROI detection" },
            { icon: "🌐", val: "In-browser", label: "All crypto ops" },
          ].map((s) => (
            <div key={s.label} style={{
              background: "#fff", border: "1px solid #e2e8f0",
              borderRadius: 12, padding: "14px 20px", textAlign: "center",
              boxShadow: "0 1px 6px rgba(0,0,0,0.05)", minWidth: 120,
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b" }}>{s.val}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" style={{ padding: "80px 24px 100px", background: "#f8fafc" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>

          {/* section label */}
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: "#4f46e5",
              letterSpacing: 1.5, textTransform: "uppercase",
              background: "#eef2ff", border: "1px solid #c7d2fe",
              padding: "4px 14px", borderRadius: 100, display: "inline-block", marginBottom: 14,
            }}>
              System Architecture
            </span>
            <h2 style={{ fontSize: "clamp(24px,4vw,38px)", fontWeight: 800, color: "#0f172a", margin: "0 0 12px" }}>
              How the 5-Phase Encryption Works
            </h2>
            <p style={{ fontSize: 15, color: "#64748b", maxWidth: 500, margin: "0 auto", lineHeight: 1.7 }}>
              Every cryptographic operation runs in the browser.
              The server stores only ciphertext — never raw keys or plaintext.
            </p>
          </div>

          {/* flow chain */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            flexWrap: "wrap", gap: 0, marginBottom: 52,
          }}>
            {PHASES.map((p, i) => (
              <div key={p.num} style={{ display: "flex", alignItems: "center" }}>
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  padding: "10px 12px",
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: p.bg, border: `2px solid ${p.accent}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    {p.emoji}
                  </div>
                  <span style={{ fontSize: 11, color: p.accent, fontWeight: 700, whiteSpace: "nowrap" }}>
                    Phase {p.num}
                  </span>
                </div>
                {i < PHASES.length - 1 && (
                  <div style={{
                    width: 36, height: 2,
                    background: `linear-gradient(to right, ${p.accent}, ${PHASES[i + 1].accent})`,
                    opacity: 0.4, flexShrink: 0,
                    position: "relative",
                  }}>
                    <span style={{
                      position: "absolute", right: -5, top: -7,
                      color: PHASES[i + 1].accent, fontSize: 12, opacity: 0.6,
                    }}>▶</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* phase cards */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
            {PHASES.map((phase, i) => (
              <PhaseCard key={phase.num} phase={phase} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY THIS MATTERS ── */}
      <section style={{
        padding: "64px 24px",
        background: "#fff",
        borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <h2 style={{ fontSize: "clamp(22px,3.5vw,32px)", fontWeight: 800, color: "#0f172a", margin: 0 }}>
              Why This Architecture is Secure
            </h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
            {[
              {
                icon: "🏛️",
                title: "Server never decrypts",
                desc: "AES keys are only decrypted client-side. Even if the server is compromised, no plaintext data leaks.",
              },
              {
                icon: "🔑",
                title: "Per-user key delegation",
                desc: "Admin re-encrypts the AES key for each user separately. Access is granular and revocable.",
              },
              {
                icon: "🧱",
                title: "No shared secrets",
                desc: "Each ROI has its own AES-256-GCM key. Compromising one key doesn't expose others.",
              },
              {
                icon: "🌐",
                title: "All crypto in-browser",
                desc: "Web Crypto API handles all RSA and AES operations locally — your private key never leaves your device.",
              },
            ].map((item) => (
              <div key={item.title} style={{
                background: "#f8fafc", border: "1px solid #e2e8f0",
                borderRadius: 14, padding: "22px 22px 18px",
                flex: "1 1 200px", minWidth: 200, maxWidth: 280,
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "72px 24px", background: "#f8fafc", textAlign: "center" }}>
        <div style={{
          maxWidth: 560, margin: "0 auto",
          background: "#fff", border: "1px solid #e2e8f0",
          borderRadius: 20, padding: "48px 36px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}>
          <div style={{ fontSize: 44, marginBottom: 16, animation: "float 3.5s ease-in-out infinite" }}>🛡️</div>
          <h3 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>
            Ready to protect your images?
          </h3>
          <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.7, margin: "0 0 28px" }}>
            Your private key is generated in your browser and never shared. Sign up in seconds.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="hero-btn-fill" onClick={() => navigate("/auth?mode=signup")}>
              Create an Account
            </button>
            <button className="hero-btn-ghost" onClick={() => navigate("/auth?mode=login")}>
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        background: "#fff", borderTop: "1px solid #e2e8f0",
        padding: "20px 40px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>🔐</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
            ROI<span style={{ color: "#4f46e5" }}>Vault</span>
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          All cryptographic operations run client-side — zero plaintext leaves your browser.
        </span>
      </footer>
    </div>
  );
}
