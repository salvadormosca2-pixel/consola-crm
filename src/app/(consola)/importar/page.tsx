import Link from 'next/link'
import type { Metadata } from 'next'

import { contarParaRevisar, listarImportaciones, listarParaRevisar, ultimoMapeo } from '@/server/imports'

import { Historial, Revisar } from './historial'
import { Importador } from './importador'

export const metadata: Metadata = { title: 'Importar · 101leads' }
export const dynamic = 'force-dynamic'

export default async function PaginaImportar({
  searchParams,
}: {
  searchParams: Promise<{ pestana?: string }>
}) {
  const { pestana } = await searchParams
  const activa = pestana === 'revisar' || pestana === 'historial' ? pestana : 'subir'

  const [mapeo, pendientes] = await Promise.all([ultimoMapeo(), contarParaRevisar()])

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[20px]">Importar</h1>
        <p className="mt-0.5 text-[12.5px] text-texto-2">
          Subí tu lista de clientes en Excel o CSV y se cargan como contactos.
        </p>
      </div>

      <nav className="flex gap-0.5 border-b border-borde" aria-label="Secciones de importación">
        <Pestana href="/importar" activa={activa === 'subir'} texto="Subir archivo" />
        <Pestana
          href="/importar?pestana=revisar"
          activa={activa === 'revisar'}
          texto="Revisar"
          cantidad={pendientes}
        />
        <Pestana href="/importar?pestana=historial" activa={activa === 'historial'} texto="Historial" />
      </nav>

      {activa === 'subir' ? (
        <Importador mapeoPrevio={mapeo} />
      ) : activa === 'revisar' ? (
        <Revisar filas={await listarParaRevisar()} />
      ) : (
        <Historial lotes={await listarImportaciones()} />
      )}
    </div>
  )
}

function Pestana({
  href,
  activa,
  texto,
  cantidad,
}: {
  href: string
  activa: boolean
  texto: string
  cantidad?: number
}) {
  return (
    <Link
      href={href as never}
      aria-current={activa ? 'page' : undefined}
      className={
        'flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ' +
        (activa
          ? 'border-acento text-texto'
          : 'border-transparent text-texto-2 hover:text-texto')
      }
    >
      {texto}
      {cantidad !== undefined && cantidad > 0 ? (
        <span className="dato rounded-[3px] border border-ambar/40 bg-ambar-tenue px-1 text-[10px] text-ambar">
          {cantidad}
        </span>
      ) : null}
    </Link>
  )
}
