import { Panel, PanelHeader } from '@/components/ui/panel'
import { conciliar } from '@/server/accounts'
import { cn } from '@/lib/utils'

/**
 * Conciliación de contadores.
 *
 * Prefiero enterarme de un descuadre que descubrirlo cuando se cae un número,
 * así que esta pantalla existe aunque casi siempre esté toda en verde.
 */
export async function TablaConciliacion() {
  const filas = await conciliar(7)

  if (filas.length === 0) {
    return (
      <Panel>
        <PanelHeader
          titulo="Conciliación"
          descripcion="Contador, mensajes registrados y acuses de Evolution, por cuenta y por día."
        />
        <p className="px-3 py-6 text-center text-[12px] text-texto-2">
          Todavía no salió ningún mensaje. Cuando empiecen los envíos, acá se compara el contador de
          cada cuenta contra la tabla de mensajes.
        </p>
      </Panel>
    )
  }

  const descuadres = filas.filter((f) => !f.cuadra).length
  const sinAcuse = filas.reduce((a, f) => a + (f.enMensajes - f.conAcuse), 0)

  return (
    <Panel>
      <PanelHeader
        titulo="Conciliación · últimos 7 días"
        descripcion={
          descuadres === 0
            ? 'Sin diferencias entre el contador y la tabla de mensajes.'
            : `${descuadres} día${descuadres === 1 ? '' : 's'} con diferencia entre el contador y los mensajes.`
        }
        acciones={
          descuadres === 0 ? (
            <span className="dato text-[11px] text-verde">cuadra</span>
          ) : (
            <span className="dato text-[11px] text-rojo">{descuadres} descuadres</span>
          )
        }
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-borde bg-elevada/50 text-left">
              <th className="rotulo px-2.5 py-1.5">Día</th>
              <th className="rotulo px-2.5 py-1.5">Cuenta</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Contador</th>
              <th className="rotulo px-2.5 py-1.5 text-right">En mensajes</th>
              <th className="rotulo px-2.5 py-1.5 text-right">Con acuse</th>
              <th className="rotulo px-2.5 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr
                key={`${f.accountId}-${f.fecha}`}
                className={cn(
                  'border-b border-borde/60 last:border-b-0',
                  !f.cuadra && 'bg-rojo/5',
                )}
              >
                <td className="dato px-2.5 py-1.5 text-texto-2">{f.fecha}</td>
                <td className="dato px-2.5 py-1.5">{f.code}</td>
                <td className="dato px-2.5 py-1.5 text-right">
                  {f.contador === null ? <span className="text-texto-2">—</span> : f.contador}
                </td>
                <td className="dato px-2.5 py-1.5 text-right">{f.enMensajes}</td>
                <td
                  className={cn(
                    'dato px-2.5 py-1.5 text-right',
                    f.conAcuse < f.enMensajes && 'text-ambar',
                  )}
                  title={
                    f.conAcuse < f.enMensajes
                      ? `${f.enMensajes - f.conAcuse} mensajes contados sin acuse de Evolution.`
                      : undefined
                  }
                >
                  {f.conAcuse}
                </td>
                <td className="px-2.5 py-1.5">
                  {f.cuadra ? (
                    <span className="dato text-[11px] text-verde">ok</span>
                  ) : (
                    <span className="dato text-[11px] text-rojo">
                      difiere en {Math.abs((f.contador ?? 0) - f.enMensajes)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-borde px-3 py-2 text-[11px] leading-relaxed text-texto-2">
        <strong className="font-medium text-texto">Contador</strong> es la caché de la cuenta;{' '}
        <strong className="font-medium text-texto">en mensajes</strong> es la fuente de verdad y es
        la que manda. <strong className="font-medium text-texto">Con acuse</strong> son los que
        volvieron confirmados por Evolution — no es una consulta aparte a Evolution, que no expone un
        contador propio por día, pero un mensaje contado sin acuse es la señal de que algo no salió.
        {sinAcuse > 0 ? ` Hay ${sinAcuse} sin acuse en la ventana.` : ''}
      </p>
    </Panel>
  )
}
