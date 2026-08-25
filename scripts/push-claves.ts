import webpush from 'web-push'

/**
 * Genera el par de claves VAPID que necesitan las notificaciones push.
 *
 *   npm run push:claves
 *
 * Sin estas claves el push queda apagado y **el botón de activar avisos no
 * aparece**: un botón que no puede funcionar es peor que no tenerlo. El resto
 * del sistema anda igual — el cartel al abrir la app cubre el mismo caso —,
 * pero los recordatorios dejan de llegar al celular sin abrir nada.
 *
 * Las claves no cambian nunca: si se regeneran, todos los celulares suscritos
 * dejan de recibir avisos y hay que volver a activarlos uno por uno.
 */

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`
Pegá esto en .env.local (y en el entorno del servidor):

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:vos@tudominio.com

Guardalas: si las regenerás, todos los setters tienen que volver a activar los
avisos en su celular.
`)
