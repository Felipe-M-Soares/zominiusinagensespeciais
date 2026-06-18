import { Navigate } from "react-router-dom";
// Esta página foi desativada — o sistema usa apenas login e senha
export default function Register() {
  return <Navigate to="/login" replace />;
}
