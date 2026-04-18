import { Navigate } from "react-router-dom";
// Esta página foi desativada — o sistema usa apenas login e senha
export default function ResetPassword() {
  return <Navigate to="/login" replace />;
}
