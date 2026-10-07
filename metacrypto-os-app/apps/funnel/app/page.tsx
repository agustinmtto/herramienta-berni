import { redirect } from "next/navigation";

// La app del funnel es UNA unidad pública: la landing puede colgarse acá,
// el wizard vive en /quiz. En la separación del funnel (docs/00, decisión de
// despliegue aparte del OS) `/` redirige para que el nodo público sea único.
export default function Home() {
  redirect("/quiz");
}
