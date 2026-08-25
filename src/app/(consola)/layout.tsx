import { Nav } from '@/components/nav'
import { requerirAdmin } from '@/server/session'
import { listarNotificaciones } from '@/server/setters/notificaciones'

/**
 * El panel.
 *
 * `requerirAdmin` vuelve a leer el usuario de la base en cada petición: un
 * setter con la cookie puesta rebota a su app, y alguien a quien di de baja
 * hace un minuto queda afuera aunque su token siga siendo criptográficamente
 * válido por 30 días.
 */
export default async function LayoutConsola({ children }: { children: React.ReactNode }) {
  const sesion = await requerirAdmin()
  const { filas, sinLeer } = await listarNotificaciones(sesion.userId)

  return (
    <div className="min-h-dvh">
      <Nav usuario={sesion.nombre} notificaciones={filas} sinLeer={sinLeer} />
      <main className="mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-4">{children}</main>
    </div>
  )
}
