import { redirect } from 'next/navigation'

/**
 * Los mensajes se mudaron a su propia ruta, y los tiempos a Seguimientos.
 *
 * Queda el redirect porque esta ruta estuvo en la barra lateral: alguien la
 * tiene abierta en una pestaña o guardada en el celular, y un 404 no explica
 * nada. Referencias sigue colgando de acá.
 */
export default function PaginaConfiguracion() {
  redirect('/mensajes')
}
