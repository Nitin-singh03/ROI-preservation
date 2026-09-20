import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Auth from "./pages/Auth";
import LandingPage from "./pages/LandingPage";
import AdminDashboard from "./pages/AdminDashboard";
import UserDashboard from "./pages/UserDashboard";
import { downloadPrivateKeyFile } from "./utils/cryptoUtils";

function Nav() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const logout = () => { localStorage.removeItem("user"); navigate("/"); };

  if (!user.user_id) return null;
  return (
    <nav style={{
      padding: "0 32px", height: 56,
      background: "#fff",
      borderBottom: "1px solid #e2e8f0",
      display: "flex", alignItems: "center", gap: 16,
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      position: "sticky", top: 0, zIndex: 500,
      boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: "linear-gradient(135deg,#4f46e5,#818cf8)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, boxShadow: "0 2px 6px rgba(79,70,229,0.3)",
        }}>🔐</div>
        <span style={{ fontWeight: 800, fontSize: 15, color: "#1e293b" }}>
          ROI<span style={{ color: "#4f46e5" }}>Vault</span>
        </span>
      </div>

      <span style={{ flex: 1 }} />

      <span style={{ fontSize: 13, color: "#64748b" }}>
        {user.username}
        <span style={{
          marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
          background: user.role === "admin" ? "#fdf2f8" : "#eef2ff",
          color: user.role === "admin" ? "#db2777" : "#4f46e5",
          border: `1px solid ${user.role === "admin" ? "#fbcfe8" : "#c7d2fe"}`,
        }}>
          {user.role.toUpperCase()}
        </span>
      </span>

      <button
        onClick={() => downloadPrivateKeyFile(user.username)}
        title="Download backup copy of your RSA Private Key"
        style={{
          background: "#eef2ff", border: "1px solid #c7d2fe",
          color: "#4f46e5", cursor: "pointer",
          padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
          fontFamily: "inherit", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 4
        }}
        onMouseOver={e => { e.currentTarget.style.background = "#e0e7ff"; }}
        onMouseOut={e => { e.currentTarget.style.background = "#eef2ff"; }}
      >
        🔑 Export Key
      </button>

      <button onClick={logout} style={{
        background: "#f8fafc", border: "1px solid #e2e8f0",
        color: "#64748b", cursor: "pointer",
        padding: "6px 16px", borderRadius: 8, fontSize: 13,
        fontFamily: "inherit", transition: "all 0.2s",
      }}
        onMouseOver={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#1e293b"; }}
        onMouseOut={e => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.color = "#64748b"; }}
      >
        Sign out
      </button>
    </nav>
  );
}

function PrivateRoute({ children, role }) {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  if (!user.user_id) return <Navigate to="/" />;
  if (role && user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/admin" element={<PrivateRoute role="admin"><AdminDashboard /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute role="user"><UserDashboard /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
