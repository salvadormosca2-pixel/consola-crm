import Link from 'next/link'
import type { Metadata } from 'next'

import { requerirAdmin } from '@/server/session'
import { listarMensajesEnviados } from '@/server/setters/avisos'
import { listarSettersActivos } from '@/server/setters/panel'

import { Mensajes } from './mensajes'

export const metadata: Metadata = { title: 'Mensajes al equipo · 101leads' }
export const dynamic = 'force-dynamic'

export default async function PaginaMensajesAlEquipo() {
  await requerirAdmin()

  const [mensajes, setters] = await Promise.all([
    listarMensajesEnviados(),
    listarSettersActivos(),
  ])

  return (
    <div className="space-y-3">
      <div>
        <Link href="/equipo" className="text-[12px] text-texto-2 hover:text-texto">
          ← Equipo
        </Link>
        <h1 className="mt-1 text-[20px]">Mensajes al equipo</h1>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-texto-2">
          Avisos, cambios de guion y coordinación, sin depender de un grupo de WhatsApp. Veo quién
          lo leyó y a qué hora.
        </p>
      </div>

      <Mensajes mensajes={mensajes} setters={setters.filter((s) => s.estado === 'activo')} />
    </div>
  )
}
