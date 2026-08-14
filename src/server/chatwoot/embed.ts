import 'server-only'

/**
 * Diagnóstico del embebido.
 *
 * En vez de esperar a que el iframe quede en blanco, se leen las cabeceras del
 * servidor de Chatwoot desde acá. Así se puede decir con precisión cuál es el
 * problema y qué hay que cambiar, en lugar de mostrar un panel vacío.
 */

export type DiagnosticoEmbed =
  | { estado: 'ok'; detalle: string }
  | {
      estado: 'bloqueado'
      cabecera: string
      valor: string
      detalle: string
      comoArreglarlo: string[]
    }
  | { estado: 'inalcanzable'; detalle: string }
  | { estado: 'sin_configurar'; detalle: string }

export async function diagnosticarEmbed(
  baseUrl: string | null,
  dominioDelCrm: string,
): Promise<DiagnosticoEmbed> {
  if (!baseUrl) {
    return {
      estado: 'sin_configurar',
      detalle: 'Todavía no cargaste la URL de Chatwoot en Configuración.',
    }
  }

  let res: Response
  try {
    res = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
  } catch (err) {
    const esTimeout = err instanceof Error && err.name === 'TimeoutError'
    return {
      estado: 'inalcanzable',
      detalle: esTimeout
        ? 'Chatwoot no respondió en 8 segundos. ¿Está levantado?'
        : `No se pudo llegar a ${baseUrl}. Revisá la URL y que el servidor esté accesible.`,
    }
  }

  const xfo = res.headers.get('x-frame-options')
  const csp = res.headers.get('content-security-policy') ?? ''
  const frameAncestors = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.toLowerCase().startsWith('frame-ancestors'))

  /*
   * X-Frame-Options no acepta lista de dominios: o es DENY, o SAMEORIGIN, o
   * nada. Si viene puesta, hay que sacarla y usar frame-ancestors, que sí
   * permite autorizar un dominio puntual.
   */
  if (xfo && /deny|sameorigin/i.test(xfo)) {
    return {
      estado: 'bloqueado',
      cabecera: 'X-Frame-Options',
      valor: xfo,
      detalle:
        `Chatwoot manda X-Frame-Options: ${xfo}, que le prohíbe al navegador mostrarlo dentro de otra página. ` +
        'Esa cabecera no admite excepciones por dominio: hay que sacarla y reemplazarla por frame-ancestors.',
      comoArreglarlo: pasosNginx(dominioDelCrm),
    }
  }

  if (frameAncestors) {
    const permitidos = frameAncestors.slice('frame-ancestors'.length).trim()
    const permiteElCrm =
      permitidos.includes(dominioDelCrm) || permitidos.includes('*') || permitidos.includes('https:')

    if (!permiteElCrm) {
      return {
        estado: 'bloqueado',
        cabecera: 'Content-Security-Policy: frame-ancestors',
        valor: permitidos,
        detalle:
          `Chatwoot solo permite embeberse desde: ${permitidos}. Falta agregar ${dominioDelCrm}.`,
        comoArreglarlo: pasosNginx(dominioDelCrm),
      }
    }
    return { estado: 'ok', detalle: `Chatwoot permite embeberse desde ${dominioDelCrm}.` }
  }

  return {
    estado: 'ok',
    detalle: 'Chatwoot no manda cabeceras que bloqueen el embebido.',
  }
}

function pasosNginx(dominio: string): string[] {
  return [
    'Chatwoot no tiene una variable de entorno para esto: la cabecera la pone el reverse proxy que tenés adelante (nginx, Caddy o Traefik).',
    `En nginx, dentro del bloque server de Chatwoot, borrá cualquier "add_header X-Frame-Options ..." y agregá: add_header Content-Security-Policy "frame-ancestors 'self' ${dominio}" always;`,
    `En Caddy: header { -X-Frame-Options; Content-Security-Policy "frame-ancestors 'self' ${dominio}" }`,
    'Si Chatwoot corre en Docker detrás de su propio nginx, el cambio va en ese nginx, no en el contenedor de Rails.',
    'Después de tocarlo, recargá la configuración del proxy y volvé a esta pantalla.',
  ]
}

/**
 * Si la consola y Chatwoot están en dominios raíz distintos, el navegador puede
 * bloquear la cookie de sesión de Chatwoot dentro del iframe y el panel va a
 * pedir login una y otra vez.
 */
export function mismoDominioRaiz(a: string, b: string): boolean {
  const raiz = (u: string) => {
    try {
      const partes = new URL(u).hostname.split('.')
      return partes.slice(-2).join('.')
    } catch {
      return ''
    }
  }
  const ra = raiz(a)
  return ra.length > 0 && ra === raiz(b)
}
