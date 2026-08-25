/*
 * Service worker de la app del setter.
 *
 * Hace tres cosas, y ninguna más:
 *
 *   1. Recibe las notificaciones push y las muestra.
 *   2. Al tocarlas, enfoca la pestaña que ya está abierta en vez de abrir otra.
 *   3. Cachea los estáticos de Next para que abrir la app sea instantáneo.
 *
 * Lo que NO hace: cachear pantallas. La cola del día cambia todo el tiempo y
 * una versión vieja en pantalla sería peor que un error de red — el setter
 * podría escribirle a un lead que ya no es suyo. Las marcas que se hacen sin
 * señal las guarda la app en el teléfono y las sincroniza al volver.
 */

const CACHE = 'consola-estaticos-v2'

self.addEventListener('install', () => {
  // La versión nueva toma el control apenas está lista: el setter no tiene por
  // qué cerrar la app para recibir un cambio de guion.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/**
 * Solo se cachea lo que el servidor declara inmutable.
 *
 * Es la única regla que hace falta y se corrige sola. En producción, los
 * archivos de `_next/static` llevan el hash del contenido en la URL y viajan
 * con `cache-control: immutable`, así que guardarlos es gratis. En desarrollo
 * viajan con `no-store` y su contenido cambia en cada recompilación: cachearlos
 * servía chunks viejos a una página nueva, y eso rompe la app en el navegador
 * sin que el servidor se entere de nada.
 */
function sePuedeGuardar(respuesta) {
  return respuesta.ok && (respuesta.headers.get('cache-control') ?? '').includes('immutable')
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return

  const esEstatico =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/iconos/')
  if (!esEstatico) return

  event.respondWith(
    (async () => {
      const cacheado = await caches.match(event.request)
      if (cacheado) return cacheado

      const respuesta = await fetch(event.request)
      if (sePuedeGuardar(respuesta)) {
        const cache = await caches.open(CACHE)
        cache.put(event.request, respuesta.clone())
      }
      return respuesta
    })(),
  )
})

self.addEventListener('push', (event) => {
  let aviso = { titulo: 'Consola', cuerpo: '', enlace: '/hoy', etiqueta: 'consola' }
  try {
    if (event.data) aviso = { ...aviso, ...event.data.json() }
  } catch {
    if (event.data) aviso.cuerpo = event.data.text()
  }

  event.waitUntil(
    self.registration.showNotification(aviso.titulo, {
      body: aviso.cuerpo,
      icon: '/iconos/icono-192.png',
      badge: '/iconos/icono-192.png',
      // La misma etiqueta reemplaza el aviso anterior en vez de apilarse: tres
      // recordatorios de seguimientos son uno solo.
      tag: aviso.etiqueta,
      renotify: true,
      data: { enlace: aviso.enlace },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const enlace = event.notification.data?.enlace ?? '/hoy'

  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin === self.location.origin) {
          await ventana.focus()
          if ('navigate' in ventana) await ventana.navigate(enlace)
          return
        }
      }
      await self.clients.openWindow(enlace)
    })(),
  )
})
