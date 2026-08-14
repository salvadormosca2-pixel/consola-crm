import { describe, expect, it } from 'vitest'

import { eventoSchema } from './webhook'

/**
 * Chatwoot cambia la forma del payload entre versiones y entre eventos, así que
 * lo importante es que el esquema acepte todas las variantes reales sin romper.
 */

const ENTRANTE_V3 = {
  event: 'message_created',
  id: 12345,
  content: 'Hola, contame',
  message_type: 'incoming',
  private: false,
  inbox: { id: 7, name: 'WA-01' },
  conversation: {
    id: 88,
    inbox_id: 7,
    status: 'open',
    meta: { sender: { id: 501, name: 'Kiosco Norte', phone_number: '+5493834567890' } },
  },
  account: { id: 1 },
}

const SALIENTE_A_MANO = {
  event: 'message_created',
  id: 12346,
  content: 'Te paso el detalle',
  message_type: 'outgoing',
  private: false,
  inbox: { id: 7 },
  conversation: { id: 88, inbox_id: 7 },
  sender: { id: 2, name: 'Salva' },
}

describe('eventoSchema', () => {
  it('acepta un entrante completo', () => {
    const r = eventoSchema.safeParse(ENTRANTE_V3)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.message_type).toBe('incoming')
      expect(r.data.conversation?.meta?.sender?.phone_number).toBe('+5493834567890')
    }
  })

  it('acepta un saliente escrito a mano', () => {
    expect(eventoSchema.safeParse(SALIENTE_A_MANO).success).toBe(true)
  })

  it('acepta message_type numérico, que usan versiones viejas', () => {
    const r = eventoSchema.safeParse({ ...ENTRANTE_V3, message_type: 0 })
    expect(r.success).toBe(true)
  })

  it('acepta id como texto', () => {
    const r = eventoSchema.safeParse({ ...ENTRANTE_V3, id: '12345' })
    expect(r.success).toBe(true)
  })

  it('acepta el contacto en sender en vez de en conversation.meta', () => {
    const sinMeta = {
      ...ENTRANTE_V3,
      conversation: { id: 88, inbox_id: 7 },
      sender: { id: 501, phone_number: '+5493834567890' },
    }
    expect(eventoSchema.safeParse(sinMeta).success).toBe(true)
  })

  it('no se rompe con campos que no conoce', () => {
    const conExtra = { ...ENTRANTE_V3, campo_nuevo: { algo: [1, 2, 3] }, otro: 'x' }
    expect(eventoSchema.safeParse(conExtra).success).toBe(true)
  })

  it('acepta contenido vacío, que pasa con adjuntos', () => {
    expect(eventoSchema.safeParse({ ...ENTRANTE_V3, content: null }).success).toBe(true)
  })

  it('acepta otros eventos que después se ignoran', () => {
    const r = eventoSchema.safeParse({ event: 'conversation_status_changed', id: 1 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.event).toBe('conversation_status_changed')
  })

  it('rechaza un payload sin evento', () => {
    expect(eventoSchema.safeParse({ id: 1, content: 'hola' }).success).toBe(false)
  })

  it('rechaza cualquier cosa que no sea un objeto', () => {
    for (const basura of [null, 'texto', 42, []]) {
      expect(eventoSchema.safeParse(basura).success).toBe(false)
    }
  })
})
