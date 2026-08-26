import type { MetadataRoute } from 'next'

/**
 * La app del setter se instala desde un link: "agregar a pantalla de inicio" y
 * le queda el ícono como cualquier otra app. Sin tiendas, sin aprobación, y se
 * actualiza sola la próxima vez que la abre.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '101leads · Setters',
    short_name: 'Setters',
    description: 'Tu cola de leads del día, para contactar por Instagram desde el celular.',
    // La raíz redirige según el rol. Apuntar directo a /hoy hacía que el
    // navegador golpeara esa ruta sin sesión cada vez que revisaba si la app
    // se puede instalar.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#02100D',
    theme_color: '#02100D',
    lang: 'es-AR',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/iconos/icono-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Cola de hoy', url: '/hoy' },
      { name: 'Mis leads', url: '/mis-leads' },
    ],
  }
}
