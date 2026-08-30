import { redirect } from 'next/navigation'

/**
 * Los mensajes y sus tiempos se mudaron a Seguimientos, que es de lo que son.
 *
 * Queda el redirect porque esta ruta estuvo en la barra lateral: alguien la
 * tiene abierta en una pestaña o guardada en el celular, y un 404 no explica
 * nada. Referencias sigue colgando de acá.
 */
export default function PaginaConfiguracion() {
  redirect('/seguimientos')
}
