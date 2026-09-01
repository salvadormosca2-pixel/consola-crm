import type { Tono } from '@/components/ui/panel'

/**
 * El registro de actividad.
 *
 * Cada acción del sistema deja una fila en `events` con quién la hizo, cuándo
 * y sobre qué contacto. Esto es el diccionario que la traduce: sin él, la
 * tabla dice `lead_segundo_enviado` y hay que saber SQL para leerla.
 *
 * Nada se borra nunca. Deshacer un envío no saca la fila del envío: agrega la
 * fila de que se deshizo. Es lo que hace que el registro sirva para resolver
 * una discusión —"yo lo mandé", "no me llegó"— en vez de solo para adornar.
 */

export const GRUPOS = ['mensajes', 'respuestas', 'leads', 'equipo'] as const
export type GrupoDeActividad = (typeof GRUPOS)[number]

export const GRUPO_META: Record<GrupoDeActividad, { label: string; detalle: string }> = {
  mensajes: { label: 'Mensajes', detalle: 'Lo que salió de las cuentas de Instagram.' },
  respuestas: { label: 'Respuestas', detalle: 'Lo que contestaron los leads y qué se hizo con eso.' },
  leads: { label: 'Leads', detalle: 'Repartos, vencimientos y traspasos.' },
  equipo: { label: 'Equipo', detalle: 'Altas, bajas, avisos y accesos.' },
}

export interface MetaDeEvento {
  label: string
  grupo: GrupoDeActividad
  tono: Tono
}

/**
 * Cómo se lee cada evento. Lo que no está acá se muestra igual, con su nombre
 * crudo: es preferible una fila fea a una acción que no quedó registrada.
 */
export const EVENTO_META: Record<string, MetaDeEvento> = {
  /* Mensajes */
  lead_abierto: { label: 'Abrió el chat', grupo: 'mensajes', tono: 'neutral' },
  lead_contactado: { label: 'Mandó el 1er mensaje', grupo: 'mensajes', tono: 'positivo' },
  lead_segundo_enviado: { label: 'Mandó un seguimiento', grupo: 'mensajes', tono: 'positivo' },
  envio_setter_deshecho: { label: 'Deshizo un envío', grupo: 'mensajes', tono: 'negativo' },
  lead_salteado: { label: 'Salteó un lead', grupo: 'mensajes', tono: 'neutral' },
  cuenta_setter_cambiada: { label: 'Cambió de cuenta', grupo: 'mensajes', tono: 'activo' },

  /* Respuestas */
  lead_respondio: { label: 'Contestó', grupo: 'respuestas', tono: 'positivo' },
  lead_clasificado: { label: 'Clasificó una respuesta', grupo: 'respuestas', tono: 'activo' },
  reunion_agendada: { label: 'Agendó reunión', grupo: 'respuestas', tono: 'positivo' },

  cuenta_setter_al_tope: { label: 'Cuenta al tope', grupo: 'mensajes', tono: 'activo' },

  /* Leads */
  leads_asignados: { label: 'Reparto de leads', grupo: 'leads', tono: 'activo' },
  lead_vencido: { label: 'Venció y volvió al pozo', grupo: 'leads', tono: 'negativo' },
  lead_devuelto: { label: 'Volvió al pozo', grupo: 'leads', tono: 'negativo' },
  lead_reasignado: { label: 'Reasignado', grupo: 'leads', tono: 'activo' },
  lead_agregado: { label: 'Lead cargado por el setter', grupo: 'leads', tono: 'positivo' },
  lead_tomado_por_admin: { label: 'Lo tomó el admin', grupo: 'leads', tono: 'activo' },
  lead_cuenta_inexistente: { label: 'Cuenta inexistente', grupo: 'leads', tono: 'negativo' },

  /* Equipo */
  setter_creado: { label: 'Setter dado de alta', grupo: 'equipo', tono: 'positivo' },
  setter_editado: { label: 'Setter editado', grupo: 'equipo', tono: 'neutral' },
  setter_pausado: { label: 'Setter pausado', grupo: 'equipo', tono: 'activo' },
  setter_reactivado: { label: 'Setter reactivado', grupo: 'equipo', tono: 'positivo' },
  setter_baja: { label: 'Setter dado de baja', grupo: 'equipo', tono: 'negativo' },
  setter_eliminado: { label: 'Setter eliminado', grupo: 'equipo', tono: 'negativo' },
  equipo_vaciado: { label: 'Equipo vaciado', grupo: 'equipo', tono: 'negativo' },
  password_restablecida: { label: 'Contraseña restablecida', grupo: 'equipo', tono: 'activo' },
  password_cambiada: { label: 'Cambió su contraseña', grupo: 'equipo', tono: 'neutral' },
  sesiones_cerradas: { label: 'Sesiones cerradas', grupo: 'equipo', tono: 'activo' },
  recordatorio_enviado: { label: 'Reclamo enviado', grupo: 'equipo', tono: 'activo' },
  mensaje_equipo_enviado: { label: 'Aviso al equipo', grupo: 'equipo', tono: 'neutral' },
  mensaje_equipo_leido: { label: 'Leyó un aviso', grupo: 'equipo', tono: 'neutral' },
  mensaje_equipo_respondido: { label: 'Respondió un aviso', grupo: 'equipo', tono: 'neutral' },
  ingreso: { label: 'Entró', grupo: 'equipo', tono: 'neutral' },
  ingreso_fallido: { label: 'Ingreso fallido', grupo: 'equipo', tono: 'negativo' },
}

/**
 * Todo tipo del sistema tiene que estar arriba. Si se agrega uno nuevo en
 * `EVENT_TYPES_SETTERS` y nadie lo traduce, el registro lo muestra igual —con
 * su nombre crudo— pero deja de poder filtrarse por grupo, que es la mitad de
 * para qué sirve la pantalla.
 */

export function metaDe(tipo: string): MetaDeEvento {
  return EVENTO_META[tipo] ?? { label: tipo, grupo: 'equipo', tono: 'neutral' }
}
