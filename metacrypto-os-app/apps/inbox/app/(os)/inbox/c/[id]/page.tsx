import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import Thread from "@/components/Thread";
import { getConversation, type EstadoAtencion } from "@/lib/data";
import { requireModulo } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  await requireModulo("inbox");
  const { id } = await params;
  const { f } = await searchParams;
  const filter = f === "pendiente" || f === "resuelto" ? (f as EstadoAtencion) : undefined;
  const conv = await getConversation(id);
  if (!conv) notFound();
  // `con-hilo` es lo que en móvil decide QUÉ panel se ve: esta ruta enseña el
  // hilo y esconde la lista; /inbox hace lo contrario. El patrón de WhatsApp
  // (lista → hilo → atrás) ya estaba en las rutas, así que no hace falta ni
  // estado ni un componente nuevo — y el botón atrás del navegador funciona.
  return (
    <div className="shell con-hilo">
      <Sidebar activeId={id} filter={filter} />
      <Thread conv={conv} volverHref={`/inbox${filter ? `?f=${filter}` : ""}`} />
    </div>
  );
}
