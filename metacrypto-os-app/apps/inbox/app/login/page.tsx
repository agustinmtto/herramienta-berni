import LoginBackground from "@/components/LoginBackground";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <LoginBackground />
      <div className="login-overlay" />
      <div className="login-card">
        <div className="login-logo-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-vertical.png" alt="MetaCrypto Club" width={158} height={108} />
        </div>
        <div className="login-sub" style={{ textAlign: "center", marginBottom: 18 }}>
          Sistema operativo del negocio
        </div>
        <div className="login-ticker" style={{ justifyContent: "center" }}>
          <span className="up">BTC ▲</span>
          <span className="up">ETH ▲</span>
          <span className="muted">·</span>
          <span>Cash collected en tiempo real</span>
        </div>
        <LoginForm />
        <div className="login-foot">Acceso restringido · equipo MetaCrypto Club</div>
      </div>
    </div>
  );
}
