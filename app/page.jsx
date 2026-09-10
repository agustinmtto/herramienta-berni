import Flow from "../components/flow";

// Página única de la landing: renderiza el componente Flow, que maneja
// todo el flujo (hero → wizard → diagnóstico → contacto → final) por máquina de estados.
export default function Home() {
  return <Flow />;
}
